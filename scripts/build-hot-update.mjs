/**
 * 构建热更新资源包
 * 
 * 1. 运行 vite build 生成 dist/
 * 2. 将 dist/ 压缩为 dist-update.zip
 * 3. 生成 hot-update.json 清单文件（包含版本号、文件大小、sha256）
 * 
 * 用法: node scripts/build-hot-update.mjs
 * 上传: 将 release/dist-update.zip 和 release/hot-update.json 上传到 GitHub Release
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const DIST_DIR = path.join(ROOT, 'dist');

// 从 package.json 读取版本号
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

console.log(`\n📦 Building hot-update package for v${VERSION}\n`);

// 1. 构建前端
console.log('Step 1: Building frontend...');
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('ERROR: dist/index.html not found after build');
  process.exit(1);
}

// 2. 压缩 dist/ 为 zip
console.log('\nStep 2: Creating dist-update.zip...');
if (!fs.existsSync(RELEASE_DIR)) fs.mkdirSync(RELEASE_DIR, { recursive: true });

const zipPath = path.join(RELEASE_DIR, 'dist-update.zip');
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// 使用 PowerShell 压缩（Windows）
if (process.platform === 'win32') {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${DIST_DIR}' -DestinationPath '${zipPath}' -Force"`, {
    timeout: 60000,
  });
} else {
  execSync(`cd "${ROOT}" && zip -r "${zipPath}" dist/`, { timeout: 60000 });
}

if (!fs.existsSync(zipPath)) {
  console.error('ERROR: Failed to create zip');
  process.exit(1);
}

const zipSize = fs.statSync(zipPath).size;
console.log(`   Created: dist-update.zip (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);

// 3. 计算 sha256
const zipBuffer = fs.readFileSync(zipPath);
const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

// 4. 生成 hot-update.json
const manifest = {
  version: VERSION,
  zipFile: 'dist-update.zip',
  zipSize,
  sha256,
  buildTime: new Date().toISOString(),
};

const manifestPath = path.join(RELEASE_DIR, 'hot-update.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`   Created: hot-update.json`);
console.log(`   Version: ${VERSION}`);
console.log(`   SHA256:  ${sha256}`);

console.log(`\n✅ Hot-update package ready!\n`);
console.log(`Files to upload to GitHub Release v${VERSION}:`);
console.log(`   ${zipPath}`);
console.log(`   ${manifestPath}`);
console.log(`\nUpload command:`);
console.log(`   $env:GH_TOKEN="<token>"; node scripts/upload-hot-update.mjs`);
