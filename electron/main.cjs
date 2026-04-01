const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { checkHotUpdate, performHotUpdate, getCurrentFrontendVersion, getLoadPath } = require('./hot-update.cjs');

const isDev = !app.isPackaged;
let mainWindow = null;

// ==================== 清理过期热更新 ====================
// 安装新 exe 后，如果 hot-dist 里的版本 <= app 内置版本，说明已过期，需要清理
// 否则用户装了新 exe 还会加载旧的 hot-dist 前端
function cleanStaleHotDist() {
  if (isDev) return;
  try {
    const appVer = app.getVersion(); // exe 内置版本
    const hotDistPath = path.join(app.getPath('userData'), 'hot-dist');
    const versionFilePath = path.join(app.getPath('userData'), 'hot-update-version.json');

    if (!fs.existsSync(hotDistPath)) return; // 没有热更新目录，无需清理

    let hotVer = '0.0.0';
    if (fs.existsSync(versionFilePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(versionFilePath, 'utf-8'));
        if (data.version) hotVer = data.version;
      } catch { /* ignore */ }
    }

    // 版本比较：如果 hot-dist 版本 <= exe 内置版本，清理掉
    const isHotNewer = compareVersions(hotVer, appVer);
    if (!isHotNewer) {
      console.log(`[updater] Cleaning stale hot-dist: hot=${hotVer}, app=${appVer}`);
      fs.rmSync(hotDistPath, { recursive: true, force: true });
      if (fs.existsSync(versionFilePath)) fs.unlinkSync(versionFilePath);
    }
  } catch (err) {
    console.error('[updater] cleanStaleHotDist error:', err.message);
  }
}

// 返回 true 如果 a > b
function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}

// ==================== Auto Updater ====================
function setupAutoUpdater() {
  if (isDev) return; // 开发模式不检查更新

  autoUpdater.autoDownload = false; // 不自动下载，让用户确认
  autoUpdater.autoInstallOnAppQuit = true;

  // 发送更新状态到渲染进程
  function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes || '',
      releaseDate: info.releaseDate || '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('update-status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    sendToRenderer('update-status', { status: 'downloaded' });
  });

  autoUpdater.on('error', (err) => {
    sendToRenderer('update-status', { status: 'error', message: err.message });
  });

  // 启动后延迟 5 秒自动检查更新
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// ==================== IPC Handlers ====================
ipcMain.handle('check-for-update', async () => {
  if (isDev) return { status: 'dev' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'ok', version: result?.updateInfo?.version };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  if (isDev) return { status: 'dev' };
  try {
    await autoUpdater.downloadUpdate();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ==================== Hot Update IPC ====================
ipcMain.handle('get-frontend-version', () => {
  if (isDev) return app.getVersion();
  return getCurrentFrontendVersion();
});

ipcMain.handle('check-hot-update', async () => {
  if (isDev) return { hasUpdate: false, currentVersion: 'dev' };
  try {
    return await checkHotUpdate();
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
});

ipcMain.handle('perform-hot-update', async () => {
  if (isDev) return { status: 'dev' };
  try {
    const sendProgress = (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hot-update-progress', data);
      }
    };
    const result = await performHotUpdate(sendProgress);
    // 热更新完成后刷新页面（从 userData/hot-dist/ 加载）
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(getLoadPath());
      }
    }, 500);
    return { status: 'ok', version: result.version };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

// ==================== Window ====================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'AAGS - Apex Adaptive Grid System',
    icon: path.join(__dirname, '../public/favicon.svg'),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(getLoadPath());
  }
}

app.whenReady().then(() => {
  cleanStaleHotDist(); // 安装新版后清理旧的热更新缓存
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
