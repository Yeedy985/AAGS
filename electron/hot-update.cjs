/**
 * Electron 前端资源热更新模块
 * 
 * 原理: Electron 壳不变，只替换 dist/ 中的前端资源文件
 * 流程: 检查 GitHub Release 上的 hot-update.json → 对比版本 → 下载 dist-update.zip → 解压替换 → 刷新窗口
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { createWriteStream, mkdirSync, existsSync, rmSync, renameSync, readFileSync, writeFileSync } = fs;

const GITHUB_OWNER = 'Yeedy985';
const GITHUB_REPO = 'AAGS';

// 获取 dist 目录路径（打包后在 resources/app/dist）
function getDistPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'dist');
  }
  return path.join(__dirname, '..', 'dist');
}

// 获取热更新临时目录
function getTempPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'hot-update-temp');
}

// 获取本地版本信息文件路径
function getLocalVersionPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'hot-update-version.json');
}

// 获取当前前端版本（优先读热更新版本，否则用 app 版本）
function getCurrentFrontendVersion() {
  const localPath = getLocalVersionPath();
  try {
    if (existsSync(localPath)) {
      const data = JSON.parse(readFileSync(localPath, 'utf-8'));
      if (data.version) return data.version;
    }
  } catch { /* ignore */ }
  const { app } = require('electron');
  return app.getVersion();
}

// HTTP(S) GET 请求，支持重定向
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: { 'User-Agent': 'AAGS-Updater' },
      ...options,
    }, (res) => {
      // 跟随重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, options).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// 下载文件到本地，返回 Promise，支持进度回调
function downloadFile(url, destPath, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const dir = path.dirname(destPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const res = await httpGet(url);
      const totalSize = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      const fileStream = createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && totalSize > 0) {
          onProgress({ downloaded, total: totalSize, percent: Math.round(downloaded / totalSize * 100) });
        }
      });
      res.pipe(fileStream);
      fileStream.on('finish', () => { fileStream.close(); resolve(); });
      fileStream.on('error', reject);
      res.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// 检查远程热更新版本
async function checkHotUpdate() {
  const currentVersion = getCurrentFrontendVersion();
  const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/hot-update.json`;

  try {
    const res = await httpGet(url);
    const body = await new Promise((resolve, reject) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    const info = JSON.parse(body);
    // info = { version: "1.0.3", zipFile: "dist-update.zip", zipSize: 12345, sha256: "..." }

    const hasUpdate = isNewer(info.version, currentVersion);
    return {
      hasUpdate,
      currentVersion,
      remoteVersion: info.version,
      zipFile: info.zipFile || 'dist-update.zip',
      zipSize: info.zipSize || 0,
      sha256: info.sha256 || '',
    };
  } catch (err) {
    return { hasUpdate: false, currentVersion, error: err.message };
  }
}

// 版本比较
function isNewer(remote, local) {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// 执行热更新
async function performHotUpdate(onProgress) {
  const checkResult = await checkHotUpdate();
  if (!checkResult.hasUpdate) {
    throw new Error('No update available');
  }

  const tempDir = getTempPath();
  const zipPath = path.join(tempDir, 'dist-update.zip');

  // 清理临时目录
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  // 1. 下载 zip
  const zipUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${checkResult.zipFile}`;
  onProgress?.({ stage: 'downloading', percent: 0 });

  await downloadFile(zipUrl, zipPath, (p) => {
    onProgress?.({ stage: 'downloading', ...p });
  });

  onProgress?.({ stage: 'extracting', percent: 0 });

  // 2. 解压 zip（使用 Node.js 内置的 zlib + 简单的 zip 解压）
  await extractZip(zipPath, tempDir);

  onProgress?.({ stage: 'replacing', percent: 50 });

  // 3. 替换 dist 目录
  const distPath = getDistPath();
  const extractedDist = path.join(tempDir, 'dist');

  // 验证解压结果
  if (!existsSync(extractedDist) || !existsSync(path.join(extractedDist, 'index.html'))) {
    throw new Error('Invalid update package: dist/index.html not found');
  }

  // 备份旧 dist
  const backupPath = distPath + '.backup';
  if (existsSync(backupPath)) rmSync(backupPath, { recursive: true, force: true });

  try {
    // 重命名当前 dist 为 backup
    renameSync(distPath, backupPath);
    // 将新 dist 移入
    renameSync(extractedDist, distPath);
    // 删除备份
    rmSync(backupPath, { recursive: true, force: true });
  } catch (err) {
    // 回滚: 恢复备份
    if (existsSync(backupPath) && !existsSync(distPath)) {
      renameSync(backupPath, distPath);
    }
    throw new Error(`Failed to replace dist: ${err.message}`);
  }

  // 4. 记录新版本
  writeFileSync(getLocalVersionPath(), JSON.stringify({
    version: checkResult.remoteVersion,
    updatedAt: new Date().toISOString(),
  }));

  // 5. 清理临时文件
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

  onProgress?.({ stage: 'done', percent: 100 });

  return { version: checkResult.remoteVersion };
}

// 简单的 ZIP 解压实现（使用 AdmZip，electron-builder 自带 Node.js）
async function extractZip(zipPath, destDir) {
  // 尝试使用 yauzl（更可靠）或回退到 shell 命令
  try {
    // 使用 PowerShell 解压 (Windows)
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, {
        timeout: 60000,
      });
      return;
    }
    // macOS / Linux
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { timeout: 60000 });
  } catch (err) {
    throw new Error(`Failed to extract zip: ${err.message}`);
  }
}

module.exports = {
  checkHotUpdate,
  performHotUpdate,
  getCurrentFrontendVersion,
};
