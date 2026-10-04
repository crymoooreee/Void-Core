const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voidCore", {
  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo")
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

  core: {
    optimize: () =>
      ipcRenderer.invoke("core:optimize")
  }
});