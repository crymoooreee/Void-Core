const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, safeStorage, shell } = require("electron");
const path = require("path");
const { AccountClient } = require("./account-client");
const { LocalSteamLibrary } = require("../core/steam/local-library");
const { createUpdateController } = require("./update-controller");
const { GamingOptimizer } = require("../core/optimizer/gaming-optimizer");
const { createWindowsProfile } = require("../core/optimizer/windows-profile");
const { SessionStore } = require("../core/performance/session-store");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const {
  getSystemInfo
} = require("../core/monitor/hardware");

const {
  getRunningGames,
  getActiveGame
} = require("../core/games/game-detector");

const {
    collectPerformance,
    getPerformanceHistory,
    resetPerformanceHistory
} = require("../core/performance/performance-monitor");

const {
    startFPSMonitor,
    stopFPSMonitor,
    getFPSData
} = require("../core/performance/fps-monitor");

let mainWindow;
let tray;
let telemetryTimer = null;
let telemetryResult = { active: false, history: [], diagnostics: [] };
let telemetryInFlight = null;
let updateController = null;
let sessionStore = null;
let optimizer = null;
let accountClient = null;
let sessionFlushTimer = null;
let shuttingDown = false;
let canQuit = false;
async function refreshTelemetry() {
  if (shuttingDown) return telemetryResult;
  if (telemetryInFlight) return telemetryInFlight;
  telemetryInFlight = collectPerformance().then(async result => {
    telemetryResult = result;
    if (sessionStore) await sessionStore.ingest(result);
    if (optimizer) await optimizer.update(result.active ? result.game : null);
    updateController?.onGameActivity(Boolean(result.active));
    return result;
  }).catch(error => {
    console.error("[Telemetry]", error.message);
    return telemetryResult;
  }).finally(() => { telemetryInFlight = null; });
  return telemetryInFlight;
}

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: `VoidCore ${app.getVersion()}`,
    width: 1280,
    height: 800,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: "#080a0d",
    icon: path.join(__dirname, "../assets/icons/app.png"),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../assets/icons/tray.png");
  let icon = nativeImage.createEmpty();

  if (require("fs").existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  }

  tray = new Tray(icon);
  tray.setToolTip(`VoidCore ${app.getVersion()}`);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open VoidCore",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    { type: "separator" },
    {
      label: "Exit",
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  }
});
app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    sessionStore = new SessionStore({
      directory: path.join(app.getPath("userData"), "sessions"),
      appVersion: app.getVersion()
    });
    await sessionStore.init();
    sessionFlushTimer = setInterval(() => sessionStore.flush(), 30000);
  } catch (error) {
    sessionStore = null;
    console.error("[Sessions] Storage initialization failed");
  }
  ipcMain.handle("sessions:list", (_event, options) => sessionStore ? sessionStore.list(options || {}) :
    { items: [], total: 0, error: "Хранилище истории недоступно. Проверьте права доступа и место на диске." });
  ipcMain.handle("sessions:get", (_event, id) => {
    if (!sessionStore) throw new Error("Хранилище истории недоступно.");
    return sessionStore.get(id);
  });
  ipcMain.handle("app:getInfo", () => ({
    name: "VoidCore",
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }));
  optimizer = new GamingOptimizer({
    file: path.join(app.getPath("userData"), "system-profile.json"),
    priorityFile: path.join(app.getPath("userData"), "optimizer.json"),
    driver: createWindowsProfile(),
    getGames: () => getRunningGames({ fresh: true }),
    onChange: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("optimizer:changed", state); }
  });
  await optimizer.init();
  ipcMain.handle("optimizer:state", () => optimizer.snapshot());
  ipcMain.handle("optimizer:configure", (_event, options) => optimizer.configure(options));
  ipcMain.handle("optimizer:revert", () => optimizer.revert());
  accountClient = new AccountClient({
    baseURL: (!app.isPackaged && process.env.VOIDCORE_API_URL) || require("./service-config.json").apiURL,
    file: path.join(app.getPath("userData"), "account-session.bin"), safeStorage,
    openExternal: url => shell.openExternal(url), allowLocalHTTP: !app.isPackaged,
    onChange: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("account:changed", state); }
  });
  const steamLibrary = new LocalSteamLibrary({ openExternal: url => shell.openExternal(url) });
  function handleAccount(channel, fn) {
    ipcMain.handle(channel, async (event, value) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw Error("Untrusted account request");
      return fn(value);
    });
  }
  handleAccount("account:state", () => accountClient.snapshot());
  handleAccount("account:register", data => accountClient.register(data));
  handleAccount("account:login", data => accountClient.login(data));
  handleAccount("account:resend", data => accountClient.mail("resend", data));
  handleAccount("account:forgot", data => accountClient.mail("forgot", data));
  handleAccount("account:refresh", () => accountClient.refreshProfile());
  handleAccount("account:logout", () => accountClient.logout());
  handleAccount("account:steam-link", () => accountClient.startSteam());
  handleAccount("account:steam-stop", () => accountClient.cancelSteam());
  handleAccount("account:steam-unlink", () => accountClient.unlinkSteam());
  handleAccount("account:steam-library", () => accountClient.library());
  handleAccount("steam:local", () => steamLibrary.scan());
  handleAccount("steam:launch", appid => steamLibrary.launch(appid));
  handleAccount("steam:open", async () => { await shell.openExternal("steam://open/main"); return { ok: true }; });
  handleAccount("account:steam-profile", async () => {
    const id = accountClient.snapshot().user?.steam?.id;
    if (typeof id !== "string" || !/^\d{17}$/.test(id)) throw Error("Steam не привязан.");
    await shell.openExternal("https://steamcommunity.com/profiles/" + id);
    return { ok: true };
  });
  createWindow();
  createTray();
  accountClient.init().catch(() => accountClient.publish("Сохранённая сессия недоступна."));
  updateController = createUpdateController({
    app, ipcMain,
    getRunningGames: () => getRunningGames({ fresh: true }),
    notify: state => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:state-changed", state);
    },
    loadUpdater: () => require("electron-updater").autoUpdater,
    createToken: () => new (require("builder-util-runtime").CancellationToken)()
  });
  updateController.start();
  refreshTelemetry();
  telemetryTimer = setInterval(refreshTelemetry, 2000);

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });

  ipcMain.handle("window:close", () => {
    mainWindow?.hide();
  });

  ipcMain.handle("window:isMaximized", () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle("monitor:getSystemInfo", async () => {
  try {
    return await getSystemInfo();
  } catch (error) {
    console.error("Hardware monitor error:", error);

    return {
      error: true,
      message: error.message || "Unable to read hardware information."
    };
  }
});

ipcMain.handle(
    "performance:get",
    async () => {

        try {

            return telemetryResult;

        } catch (error) {

            console.error(
                "Performance monitor:",
                error
            );

            return {
                active: false,
                error: true,
                message:
                    error.message
            };

        }

    }
);

ipcMain.handle(
    "fps:start",
    async (
        event,
        pid
    ) => {

        return startFPSMonitor(pid);

    }
);


ipcMain.handle(
    "fps:stop",
    async () => {

        return stopFPSMonitor();

    }
);


ipcMain.handle(
    "fps:get",
    async () => {

        return getFPSData();

    }
);


ipcMain.handle(
    "performance:history",
    () => {

        return getPerformanceHistory();

    }
);


ipcMain.handle(
    "performance:reset",
    () => {

        resetPerformanceHistory();

        return true;

    }
);

ipcMain.handle(
  "games:getRunning",
  async () => {

    try {

      return await getRunningGames();

    } catch (error) {

      console.error(
        "Game detector error:",
        error
      );

      return [];

    }

  }
);


ipcMain.handle(
  "games:getActive",
  async () => {

    try {

      return await getActiveGame();

    } catch (error) {

      console.error(
        "Active game detector error:",
        error
      );

      return null;

    }

  }
);

  ipcMain.handle("core:optimize", () => optimizer.optimize());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", event => {
  if (canQuit) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  accountClient?.close();
  updateController?.dispose();
  clearInterval(telemetryTimer);
  clearInterval(sessionFlushTimer);
  (async () => {
    try {
      if (telemetryInFlight) await telemetryInFlight;
      if (sessionStore) await sessionStore.close();
      if (optimizer) await optimizer.close();
    } finally {
      stopFPSMonitor();
      canQuit = true;
      app.quit();
    }
  })().catch(() => { canQuit = true; app.quit(); });
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
