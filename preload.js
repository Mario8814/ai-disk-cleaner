const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listDrives: () => ipcRenderer.invoke('list-drives'),
  scan: (root) => ipcRenderer.invoke('scan', root),
  scanCancel: () => ipcRenderer.invoke('scan-cancel'),
  onScanProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  listApps: () => ipcRenderer.invoke('list-apps'),
  uninstallApp: (app) => ipcRenderer.invoke('uninstall-app', app),

  trashItems: (paths, opts) => ipcRenderer.invoke('trash-items', paths, opts),
  deletePermanently: (paths) => ipcRenderer.invoke('delete-permanently', paths),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),

  getAIConfig: () => ipcRenderer.invoke('ai-config-get'),
  setAIConfig: (cfg) => ipcRenderer.invoke('ai-config-set', cfg),
  aiAnalyze: (payload) => ipcRenderer.invoke('ai-analyze', payload),
});
