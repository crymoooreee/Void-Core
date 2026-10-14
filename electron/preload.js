const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voidCore", {
  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo")
  },
  account: {
    getState: () => ipcRenderer.invoke("account:state"),
    register: data => ipcRenderer.invoke("account:register", data),
    login: data => ipcRenderer.invoke("account:login", data),
    resend: data => ipcRenderer.invoke("account:resend", data),
    forgot: data => ipcRenderer.invoke("account:forgot", data),
    refresh: () => ipcRenderer.invoke("account:refresh"),
    logout: () => ipcRenderer.invoke("account:logout"),
    openSteamProfile: () => ipcRenderer.invoke("account:steam-profile"),
    linkSteam: () => ipcRenderer.invoke("account:steam-link"),
    stopSteam: () => ipcRenderer.invoke("account:steam-stop"),
    unlinkSteam: () => ipcRenderer.invoke("account:steam-unlink"),
    getSteamLibrary: () => ipcRenderer.invoke("account:steam-library"),
    onState: listener => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("account:changed", handler);
      return () => ipcRenderer.removeListener("account:changed", handler);
    }
  },
  steam: {
    open: () => ipcRenderer.invoke("steam:open"),
    getLocalGames: () => ipcRenderer.invoke("steam:local"),
    launch: appid => ipcRenderer.invoke("steam:launch", appid)
  },
  updates: {
    getState: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onState: listener => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("updates:state-changed", handler);
      return () => ipcRenderer.removeListener("updates:state-changed", handler);
    }
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),

    maximize: () => ipcRenderer.invoke("window:maximize"),

    close: () => ipcRenderer.invoke("window:close"),

    isMaximized: () =>
      ipcRenderer.invoke("window:isMaximized")
  },

  sessions: {
    list: options => ipcRenderer.invoke("sessions:list", options),
    get: id => ipcRenderer.invoke("sessions:get", id)
  },
  games: {
      getRunning: () =>
        ipcRenderer.invoke(
          "games:getRunning"
        ),

      getActive: () =>
        ipcRenderer.invoke(
          "games:getActive"
        )

  },

  fps: {
    start: (
        pid
    ) =>
        ipcRenderer.invoke(
            "fps:start",
            pid
        ),

    stop: () =>
        ipcRenderer.invoke(
            "fps:stop"
        ),

    get: () =>
        ipcRenderer.invoke(
            "fps:get"
        )
  },

  performance: {

      get: () =>
          ipcRenderer.invoke(
              "performance:get"
          ),

      getHistory: () =>
          ipcRenderer.invoke(
              "performance:history"
          ),

      reset: () =>
          ipcRenderer.invoke(
              "performance:reset"
          )

  },

  monitor: {
    getSystemInfo: () =>
      ipcRenderer.invoke("monitor:getSystemInfo")
  },

  optimizer: {
    getState: () => ipcRenderer.invoke("optimizer:state"),
    configure: options => ipcRenderer.invoke("optimizer:configure", options),
    revert: () => ipcRenderer.invoke("optimizer:revert"),
    onState: listener => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("optimizer:changed", handler);
      return () => ipcRenderer.removeListener("optimizer:changed", handler);
    }
  },
  core: {
    optimize: () =>
      ipcRenderer.invoke("core:optimize")
  }
});