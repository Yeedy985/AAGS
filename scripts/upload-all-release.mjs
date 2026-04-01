/**
 * 一键上传所有 Release 资源到 GitHub
 * 自动替换已有的同名文件
 * 用法: node scripts/upload-all-release.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Yeedy985';
const REPO = 'AAGS';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

const FILES = [
  { name: `AAGS-Setup-${VERSION}.exe`, contentType: 'application/octet-stream' },
  { name: `AAGS-Setup-${VERSION}.exe.blockmap`, contentType: 'application/octet-stream' },
  { name: 'latest.yml', contentType: 'text/yaml' },
  { name: 'dist-update.zip', contentType: 'application/zip' },
  { name: 'hot-update.json', contentType: 'application/json' },
];

async function main() {
  if (!TOKEN) {
    console.error('ERROR: GH_TOKEN environment variable is required');
    process.exit(1);
  }

  // 检查所有文件存在
  for (const f of FILES) {
    const p = path.join(ROOT, 'release', f.name);
    if (!fs.existsSync(p)) {
      console.error(`ERROR: File not found: ${p}`);
      process.exit(1);
    }
  }

  // 获取 Release
  console.log(`\n📦 Uploading all assets to Release ${TAG}...\n`);
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    console.error(`Failed to find release ${TAG}: ${res.status}`);
    process.exit(1);
  }
  const release = await res.json();
  console.log(`Release found: ${release.html_url} (${release.assets.length} existing assets)\n`);

  // 逐个上传
  for (const f of FILES) {
    const filePath = path.join(ROOT, 'release', f.name);
    const buffer = fs.readFileSync(filePath);
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);

    // 删除同名旧文件
    const existing = release.assets.find(a => a.name === f.name);
    if (existing) {
      process.stdout.write(`  🗑️  Deleting old ${f.name}... `);
      const delRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
      });
      console.log(delRes.ok ? 'done' : `FAILED (${delRes.status})`);
    }

    // 上传新文件
    process.stdout.write(`  ⬆️  Uploading ${f.name} (${sizeMB} MB)... `);
    const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(f.name)}`);
    const upRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': f.contentType,
        Accept: 'application/vnd.github+json',
      },
      body: buffer,
    });

    if (upRes.ok) {
      const asset = await upRes.json();
      console.log(`✅ ${asset.browser_download_url}`);
    } else {
      const err = await upRes.text();
      console.log(`❌ ${upRes.status} - ${err}`);
    }
  }

  console.log(`\n✅ All assets uploaded to ${TAG}!`);
  console.log(`Release URL: ${release.html_url}`);
}

main().catch(e => { console.error(e); process.exit(1); });
