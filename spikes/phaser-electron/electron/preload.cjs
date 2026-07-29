const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopShell", {
  setInteractive(interactive, reason) {
    ipcRenderer.send("desktop:set-interactive", {
      interactive: Boolean(interactive),
      reason: String(reason ?? "unknown"),
    });
  },
  setAlwaysOnTop(enabled) {
    ipcRenderer.send("desktop:set-always-on-top", Boolean(enabled));
  },
  reportTestPoints(points) {
    ipcRenderer.send("desktop:report-test-points", points);
  },
  quit() {
    ipcRenderer.send("desktop:quit");
  },
  getEnvironment() {
    return ipcRenderer.invoke("desktop:get-environment");
  },
  onCursorPosition(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:cursor-position", listener);
    return () => ipcRenderer.removeListener("desktop:cursor-position", listener);
  },
  onPassthroughState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:passthrough-state", listener);
    return () => ipcRenderer.removeListener("desktop:passthrough-state", listener);
  },
  onMetrics(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:metrics", listener);
    return () => ipcRenderer.removeListener("desktop:metrics", listener);
  },
});
