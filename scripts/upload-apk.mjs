/**
 * 上传 Android APK 到已有的 GitHub Release v1.0.3
 * 用法: GH_TOKEN=xxx node scripts/upload-apk.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Yeedy985';
const REPO = 'AAGS';
const TAG = 'v1.0.3';

async function main() {
  if (!TOKEN) {
    console.error('ERROR: GH_TOKEN environment variable is required');
    process.exit(1);
  }

  const apkPath = path.resolve(__dirname, '..', 'release', 'AAGS-1.0.3.apk');
  if (!fs.existsSync(apkPath)) {
    console.error('ERROR: APK not found at', apkPath);
    process.exit(1);
  }

  const apkBuffer = fs.readFileSync(apkPath);
  console.log(`Found: AAGS-1.0.3.apk (${(apkBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

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

  // 上传 APK
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent('AAGS-1.0.3.apk')}`);
  console.log('Uploading AAGS-1.0.3.apk...');

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/vnd.android.package-archive',
      'Accept': 'application/vnd.github+json',
    },
    body: apkBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error(`Failed to upload: ${uploadRes.status} ${err}`);
    process.exit(1);
  }

  const asset = await uploadRes.json();
  console.log(`\n✅ Android APK uploaded successfully!`);
  console.log(`Download: ${asset.browser_download_url}`);
  console.log(`Release: ${release.html_url}`);
}

main().catch(console.error);
