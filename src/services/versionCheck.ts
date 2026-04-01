/**
 * Version Check Service — 版本检查
 * 定期检查 GitHub 上的最新版本，与本地版本对比
 */

const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/Yeedy985/AAGS/main/package.json';
const CHECK_INTERVAL = 30 * 60 * 1000; // 30 分钟检查一次
const LOCAL_VERSION = __APP_VERSION__;  // 构建时注入

let _latestVersion: string | null = null;
let _checkTimer: ReturnType<typeof setInterval> | null = null;
let _onNewVersion: ((latest: string, current: string) => void) | null = null;

export function getLocalVersion(): string {
  return LOCAL_VERSION;
}

export function getLatestVersion(): string | null {
  return _latestVersion;
}

export function hasNewVersion(): boolean {
  if (!_latestVersion) return false;
  return compareVersions(_latestVersion, LOCAL_VERSION) > 0;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

async function checkVersion(): Promise<void> {
  try {
    const res = await fetch(GITHUB_VERSION_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const pkg = await res.json();
    const latest = pkg.version;
    if (latest && compareVersions(latest, LOCAL_VERSION) > 0) {
      _latestVersion = latest;
      _onNewVersion?.(latest, LOCAL_VERSION);
    }
  } catch {
    // 静默失败
  }
}

export function startVersionCheck(onNewVersion?: (latest: string, current: string) => void): void {
  _onNewVersion = onNewVersion || null;
  // 启动后 10 秒首次检查
  setTimeout(checkVersion, 10000);
  _checkTimer = setInterval(checkVersion, CHECK_INTERVAL);
}

export function stopVersionCheck(): void {
  if (_checkTimer) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}
