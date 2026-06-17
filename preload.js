const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Konfiguration
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (updates) => ipcRenderer.invoke('config:save', updates),

  // Download
  startDownload: () => ipcRenderer.invoke('download:start'),
  onDownloadLog: (cb) => {
    const handler = (_e, line) => cb(line);
    ipcRenderer.on('download:log', handler);
    return () => ipcRenderer.removeListener('download:log', handler);
  },

  // Logs
  getLogs: () => ipcRenderer.invoke('logs:get'),

  // Ordner
  openFolder: () => ipcRenderer.invoke('folder:open'),
  selectFolder: () => ipcRenderer.invoke('folder:select'),

  // Aufgabenplaner
  createSchedulerTask: () => ipcRenderer.invoke('scheduler:create'),
});
