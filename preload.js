
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hotkeyAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),

  pickProgram: () => ipcRenderer.invoke("pick-program"),
  scanProgramFolder: () => ipcRenderer.invoke("scan-program-folder"),
  getProgramCatalog: () => ipcRenderer.invoke("get-program-catalog"),

  getShortcuts: () => ipcRenderer.invoke("get-shortcuts"),
  saveShortcuts: items => ipcRenderer.invoke("save-shortcuts", items),

  onMaximizeChange: callback => {
    ipcRenderer.on("window-maximize-change", (_event, value) => {
      callback(value);
    });
  },

  onShortcutsUpdated: callback => {
    ipcRenderer.on("shortcuts-updated", (_event, items) => {
      callback(items);
    });
  },

  onLaunchError: callback => {
    ipcRenderer.on("launch-error", (_event, error) => {
      callback(error);
    });
  }
});
