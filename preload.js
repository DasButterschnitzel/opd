const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Konfiguration
  getConfig:  () => ipcRenderer.invoke('config:get'),
  saveConfig: (updates) => ipcRenderer.invoke('config:save', updates),

  // Download
  startDownload: () => ipcRenderer.invoke('download:start'),
  catchUpDownload: (targetDate) => ipcRenderer.invoke('download:start', { targetDate }),
  cancelDownload: () => ipcRenderer.invoke('download:abort'),

  // Diagnose / Status / verpasste Tage
  runDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
  getMissedDates: () => ipcRenderer.invoke('missed:get'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  onDownloadLog: (cb) => {
    const handler = (_e, line) => cb(line);
    ipcRenderer.on('download:log', handler);
    return () => ipcRenderer.removeListener('download:log', handler);
  },

  // Dateien
  getFilesToday: () => ipcRenderer.invoke('files:today'),
  getLogs:       () => ipcRenderer.invoke('logs:get'),

  // Ordner
  openFolder:   () => ipcRenderer.invoke('folder:open'),
  selectFolder: () => ipcRenderer.invoke('folder:select'),

  // Dateien öffnen
  openFile: (absolutePath) => ipcRenderer.invoke('file:open', absolutePath),

  // Login testen
  testLogin: () => ipcRenderer.invoke('login:test'),

  // Tray-Aktionen (download / settings / log)
  onTrayAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('tray:action', handler);
    return () => ipcRenderer.removeListener('tray:action', handler);
  },

  // Aufgabenplaner
  createSchedulerTask: () => ipcRenderer.invoke('scheduler:create'),
});
