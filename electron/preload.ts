// @ts-ignore
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onEnginePort: (cb: (port: number) => void) => {
    ipcRenderer.on("engine:port", (_event: any, port: number) => cb(port));
  },
  onAistclawPort: (cb: (port: number) => void) => {
    ipcRenderer.on("aistclaw:port", (_event: any, port: number) => cb(port));
  },
});
