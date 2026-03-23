/**
 * 上传 EXE / blockmap / latest.yml 到 GitHub Release
 * 自动从 package.json 读取版本号
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Yeedy985';
const REPO = 'AAGS';
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

async function main() {
  if (!TOKEN) { console.error('ERROR: GH_TOKEN required'); process.exit(1); }

  // 1. 获取 Release
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  const release = await res.json();
  console.log(`Release: ${release.tag_name}, ${release.assets.length} assets`);

  // 2. 删除旧的 EXE, blockmap, latest.yml
  const exeName = `AAGS-Setup-${VERSION}.exe`;
  const toDelete = [exeName, `${exeName}.blockmap`, `AAGS.Setup.${VERSION}.exe`, `AAGS.Setup.${VERSION}.exe.blockmap`, 'latest.yml'];
  for (const asset of release.assets) {
    if (toDelete.includes(asset.name)) {
      console.log(`Deleting: ${asset.name} (${asset.id})...`);
      const delRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
      });
      console.log(delRes.ok ? '  Deleted' : `  Failed: ${delRes.status}`);
    }
  }

  // 3. 上传新的 EXE
  const exePath = path.resolve(__dirname, '..', 'release', exeName);
  if (fs.existsSync(exePath)) {
    const buf = fs.readFileSync(exePath);
    console.log(`Uploading ${exeName} (${(buf.length / 1024 / 1024).toFixed(1)} MB)...`);
    const url = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(exeName)}`);
    const upRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', Accept: 'application/vnd.github+json' },
      body: buf,
    });
    console.log(upRes.ok ? '  Uploaded EXE' : `  Failed: ${upRes.status}`);
  }

  // 4. 上传新的 blockmap
  const bmPath = path.resolve(__dirname, '..', 'release', `${exeName}.blockmap`);
  if (fs.existsSync(bmPath)) {
    const buf = fs.readFileSync(bmPath);
    console.log('Uploading blockmap...');
    const url = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(`${exeName}.blockmap`)}`);
    const upRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', Accept: 'application/vnd.github+json' },
      body: buf,
    });
    console.log(upRes.ok ? '  Uploaded blockmap' : `  Failed: ${upRes.status}`);
  }

  // 5. 上传新的 latest.yml
  const ymlPath = path.resolve(__dirname, '..', 'release', 'latest.yml');
  if (fs.existsSync(ymlPath)) {
    const buf = fs.readFileSync(ymlPath);
    console.log('Uploading latest.yml...');
    const url = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent('latest.yml')}`);
    const upRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', Accept: 'application/vnd.github+json' },
      body: buf,
    });
    console.log(upRes.ok ? '  Uploaded latest.yml' : `  Failed: ${upRes.status}`);
  }

  console.log('\n✅ Release assets fixed!');
}

main().catch(e => { console.error(e); process.exit(1); });
