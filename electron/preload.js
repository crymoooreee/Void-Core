const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voidCore", {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),

    maximize: () => ipcRenderer.invoke("window:maximize"),

    close: () => ipcRenderer.invoke("window:close"),

    isMaximized: () =>
      ipcRenderer.invoke("window:isMaximized")
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

  monitor: {
    getSystemInfo: () =>
      ipcRenderer.invoke("monitor:getSystemInfo")
  },

  core: {
    optimize: () =>
      ipcRenderer.invoke("core:optimize")
  }
});