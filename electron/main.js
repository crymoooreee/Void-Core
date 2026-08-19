const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require("electron");
const path = require("path");

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

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: "#080a0d",
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

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
  tray.setToolTip("VoidCore");

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

app.whenReady().then(() => {
  createWindow();
  createTray();

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

            return await collectPerformance();

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

        startFPSMonitor(pid);

        return true;

    }
);


ipcMain.handle(
    "fps:stop",
    async () => {

        stopFPSMonitor();

        return true;

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

  ipcMain.handle("core:optimize", () => {
    return {
      success: true,
      message: "Optimization engine will be connected in Stage 4."
    };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
