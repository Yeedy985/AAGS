/**
 * 上传热更新资源包到已有的 GitHub Release
 * 用法: GH_TOKEN=xxx node scripts/upload-hot-update.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Yeedy985';
const REPO = 'AAGS';

// 从 package.json 读取版本
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const TAG = `v${pkg.version}`;

const FILES = [
  { path: path.join(ROOT, 'release', 'dist-update.zip'), contentType: 'application/zip' },
  { path: path.join(ROOT, 'release', 'hot-update.json'), contentType: 'application/json' },
];

async function main() {
  if (!TOKEN) {
    console.error('ERROR: GH_TOKEN environment variable is required');
    process.exit(1);
  }

  // 检查文件存在
  for (const f of FILES) {
    if (!fs.existsSync(f.path)) {
      console.error(`ERROR: File not found: ${f.path}`);
      console.error('Run "node scripts/build-hot-update.mjs" first');
      process.exit(1);
    }
  }

  // 获取 Release
  console.log(`Finding release for tag ${TAG}...`);
  const releaseRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!releaseRes.ok) {
    console.error(`Failed to find release: ${releaseRes.status}`);
    process.exit(1);
  }
  const release = await releaseRes.json();
  console.log(`Release found: ${release.html_url}`);

  // 删除同名旧 assets
  for (const f of FILES) {
    const name = path.basename(f.path);
    const existing = release.assets.find(a => a.name === name);
    if (existing) {
      console.log(`Deleting old ${name}...`);
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
      });
    }
  }

  // 上传新文件
  for (const f of FILES) {
    const name = path.basename(f.path);
    const buffer = fs.readFileSync(f.path);
    console.log(`Uploading ${name} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)...`);

    const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(name)}`);
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': f.contentType,
        Accept: 'application/vnd.github+json',
      },
      body: buffer,
    });

    if (res.ok) {
      const asset = await res.json();
      console.log(`  ✅ ${asset.browser_download_url}`);
    } else {
      console.error(`  ❌ Upload failed: ${res.status}`);
    }
  }

  console.log('\n✅ Hot-update assets uploaded!');
}

main().catch(e => { console.error(e); process.exit(1); });
