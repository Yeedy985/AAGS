/**
 * 上传 macOS dmg 到已有的 GitHub Release v1.0.2
 * 用法: GH_TOKEN=xxx node scripts/upload-dmg.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Yeedy985';
const REPO = 'AAGS';
const TAG = 'v1.0.2';

async function main() {
  if (!TOKEN) {
    console.error('ERROR: GH_TOKEN environment variable is required');
    process.exit(1);
  }

  // 找到 dmg 文件
  const releaseDir = path.resolve(__dirname, '..', 'release');
  const files = fs.readdirSync(releaseDir);
  const dmgFile = files.find(f => f.endsWith('.dmg'));
  if (!dmgFile) {
    console.error('ERROR: No .dmg file found in release/ directory');
    console.error('Available files:', files.join(', '));
    process.exit(1);
  }

  const dmgPath = path.resolve(releaseDir, dmgFile);
  const dmgBuffer = fs.readFileSync(dmgPath);
  console.log(`Found: ${dmgFile} (${(dmgBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

  // 获取已有 Release
  console.log(`Finding release for tag ${TAG}...`);
  const releaseRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
    },
  });

  if (!releaseRes.ok) {
    console.error(`Failed to find release: ${releaseRes.status}`);
    process.exit(1);
  }

  const release = await releaseRes.json();
  console.log(`Release found: ${release.html_url}`);

  // 上传 dmg
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(dmgFile)}`);
  console.log(`Uploading ${dmgFile}...`);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Accept': 'application/vnd.github+json',
    },
    body: dmgBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error(`Failed to upload: ${uploadRes.status} ${err}`);
    process.exit(1);
  }

  const asset = await uploadRes.json();
  console.log(`\n✅ macOS dmg uploaded successfully!`);
  console.log(`Download: ${asset.browser_download_url}`);
  console.log(`Release: ${release.html_url}`);
}

main().catch(console.error);
