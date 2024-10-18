const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  dbInsert: (table, data) => ipcRenderer.invoke('db-insert', table, data),
  dbSelect: (table) => ipcRenderer.invoke('db-select', table),
  dbUpdate: (table, id, data) => ipcRenderer.invoke('db-update', table, id, data),
  dbDelete: (table, id) => ipcRenderer.invoke('db-delete', table, id),
  generatePdf: (data) => ipcRenderer.invoke('generate-pdf', data),
  getPreviousReports: () => ipcRenderer.invoke('get-previous-reports'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update_available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update_downloaded', callback),
  isClosingTime: () => ipcRenderer.invoke('is-closing-time'),
  onMenuUndo: (callback) => ipcRenderer.on('menu-undo', callback),
  onMenuRedo: (callback) => ipcRenderer.on('menu-redo', callback),
  onMenuGenerateReport: (callback) => ipcRenderer.on('menu-generate-report', callback),
  onMenuViewPreviousReport: (callback) => ipcRenderer.on('menu-view-previous-report', callback),
});
