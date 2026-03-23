const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  // Auto-update APIs (full EXE update)
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  // Hot-update APIs (frontend resources only)
  getFrontendVersion: () => ipcRenderer.invoke('get-frontend-version'),
  checkHotUpdate: () => ipcRenderer.invoke('check-hot-update'),
  performHotUpdate: () => ipcRenderer.invoke('perform-hot-update'),
  onHotUpdateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hot-update-progress', handler);
    return () => ipcRenderer.removeListener('hot-update-progress', handler);
  },
});
