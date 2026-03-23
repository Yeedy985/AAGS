import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'Yeedy985';
const REPO = 'AAGS';
const TAG = 'v1.0.3';
const NAME = 'v1.0.3';
const BODY = `## v1.0.3

- ✨ 策略广场心跳机制：自动检测策略在线状态，离线策略自动隐藏/移除
- ✨ 终止策略确认弹窗：显示挂单数量，支持一键取消所有挂单
- 🔧 增强取消挂单逻辑：先取消本地记录，再清理交易所残留挂单
- 🐛 修复同币对多策略数据隔离：未启动策略不再统计其他策略的成交和盈亏
- 🐛 修复百分比模式创建策略时价格范围显示不正确的问题
`;

const EXE_PATH = path.resolve(__dirname, '..', 'release', 'AAGS-Setup-1.0.3.exe');

async function main() {
  if (!TOKEN) {
    console.error('ERROR: GH_TOKEN environment variable is required');
    process.exit(1);
  }

  // Step 1: Create Release
  console.log('Creating release...');
  const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
    },
    body: JSON.stringify({
      tag_name: TAG,
      name: NAME,
      body: BODY,
      draft: false,
      prerelease: false,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(`Failed to create release: ${createRes.status} ${err}`);
    process.exit(1);
  }

  const release = await createRes.json();
  console.log(`Release created: ${release.html_url}`);

  // Step 2: Upload exe asset
  if (!fs.existsSync(EXE_PATH)) {
    console.error(`ERROR: exe not found at ${EXE_PATH}`);
    process.exit(1);
  }

  const exeBuffer = fs.readFileSync(EXE_PATH);
  const fileName = path.basename(EXE_PATH);
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(fileName)}`);

  console.log(`Uploading ${fileName} (${(exeBuffer.length / 1024 / 1024).toFixed(1)} MB)...`);

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Accept': 'application/vnd.github+json',
    },
    body: exeBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error(`Failed to upload asset: ${uploadRes.status} ${err}`);
    process.exit(1);
  }

  const asset = await uploadRes.json();
  console.log(`Asset uploaded: ${asset.browser_download_url}`);

  // Step 3: Also upload latest.yml for electron-updater
  const latestYmlPath = path.resolve(__dirname, '..', 'release', 'latest.yml');
  if (fs.existsSync(latestYmlPath)) {
    console.log('Uploading latest.yml...');
    const ymlBuffer = fs.readFileSync(latestYmlPath);
    const ymlUploadUrl = release.upload_url.replace('{?name,label}', `?name=latest.yml`);
    const ymlRes = await fetch(ymlUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/vnd.github+json',
      },
      body: ymlBuffer,
    });
    if (ymlRes.ok) {
      console.log('latest.yml uploaded');
    } else {
      console.warn('Warning: failed to upload latest.yml');
    }
  }

  // Step 4: Upload blockmap for delta updates
  const blockmapPath = path.resolve(__dirname, '..', 'release', 'AAGS-Setup-1.0.3.exe.blockmap');
  if (fs.existsSync(blockmapPath)) {
    console.log('Uploading blockmap...');
    const bmBuffer = fs.readFileSync(blockmapPath);
    const bmUploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent('AAGS-Setup-1.0.3.exe.blockmap')}`);
    const bmRes = await fetch(bmUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/vnd.github+json',
      },
      body: bmBuffer,
    });
    if (bmRes.ok) {
      console.log('blockmap uploaded');
    } else {
      console.warn('Warning: failed to upload blockmap');
    }
  }

  console.log('\n✅ Release v1.0.1 created and all assets uploaded!');
  console.log(`Release URL: ${release.html_url}`);
  console.log(`Download: https://github.com/${OWNER}/${REPO}/releases/latest/download/${encodeURIComponent(fileName)}`);
}

main().catch(console.error);
