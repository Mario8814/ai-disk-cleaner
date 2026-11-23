const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { scanDirectory } = require('./lib/scanner');
const { listApps } = require('./lib/apps');
const { uninstallApp } = require('./lib/uninstall');
const { listDrives, trashItems, deletePermanently, openPath, showInFolder } = require('./lib/system');
const { getAIConfig, setAIConfig, analyzeWithAI, chatWithAI } = require('./lib/ai');

let mainWindow = null;
const scanState = { active: false, cancel: false };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'AI 磁盘管家',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('list-drives', () => listDrives());
ipcMain.handle('list-apps', () => listApps());
ipcMain.handle('uninstall-app', (_e, appInfo) => uninstallApp(appInfo));
ipcMain.handle('trash-items', (_e, paths, opts) => trashItems(paths, opts));
ipcMain.handle('delete-permanently', (_e, paths) => deletePermanently(paths));
ipcMain.handle('open-path', (_e, p) => openPath(p));
ipcMain.handle('show-in-folder', (_e, p) => showInFolder(p));

ipcMain.handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择要扫描的文件夹',
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('scan', async (_e, root) => {
  if (scanState.active) throw new Error('已有扫描任务在进行中');
  scanState.active = true;
  scanState.cancel = false;
  try {
    return await scanDirectory(root, {
      onProgress: (d) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan-progress', d);
        }
      },
      shouldCancel: () => scanState.cancel,
    });
  } finally {
    scanState.active = false;
  }
});

ipcMain.handle('scan-cancel', () => {
  scanState.cancel = true;
  return true;
});

ipcMain.handle('ai-config-get', () => getAIConfig());
ipcMain.handle('ai-config-set', (_e, cfg) => setAIConfig(cfg));
ipcMain.handle('ai-analyze', (_e, payload) => analyzeWithAI(payload));
ipcMain.handle('ai-chat', (_e, messages, targetPath, scanContext) => chatWithAI(messages, targetPath, scanContext));
