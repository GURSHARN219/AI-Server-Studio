import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onEnginePort: (cb: (port: number) => void) => {
    const listener = (_event: IpcRendererEvent, port: number) => cb(port);
    ipcRenderer.on("engine:port", listener);
    return () => ipcRenderer.removeListener("engine:port", listener);
  },
  onAistclawPort: (cb: (port: number) => void) => {
    const listener = (_event: IpcRendererEvent, port: number) => cb(port);
    ipcRenderer.on("aistclaw:port", listener);
    return () => ipcRenderer.removeListener("aistclaw:port", listener);
  },
});
