import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, CheckCircle, XCircle, X, Loader2, ArrowUpCircle } from 'lucide-react';

// ==================== Types ====================
interface UpdateStatus {
  status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
  releaseNotes?: string;
}

interface HotUpdateProgress {
  stage: 'downloading' | 'extracting' | 'replacing' | 'done';
  percent?: number;
  downloaded?: number;
  total?: number;
}

interface HotUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion?: string;
  remoteVersion?: string;
  zipSize?: number;
  error?: string;
}

interface ElectronAPI {
  isElectron: boolean;
  getAppVersion: () => Promise<string>;
  checkForUpdate: () => Promise<{ status: string; version?: string; message?: string }>;
  downloadUpdate: () => Promise<{ status: string; message?: string }>;
  installUpdate: () => void;
  onUpdateStatus: (callback: (data: UpdateStatus) => void) => () => void;
  // Hot-update APIs
  getFrontendVersion: () => Promise<string>;
  checkHotUpdate: () => Promise<HotUpdateCheckResult>;
  performHotUpdate: () => Promise<{ status: string; version?: string; message?: string }>;
  onHotUpdateProgress: (callback: (data: HotUpdateProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ==================== AppUpdater Component ====================
export default function AppUpdater() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);

  const isElectron = !!window.electronAPI?.isElectron;

  useEffect(() => {
    if (!isElectron) return;

    window.electronAPI!.getAppVersion().then(v => setAppVersion(v));

    const cleanup = window.electronAPI!.onUpdateStatus((data) => {
      setStatus(data);
      if (data.status === 'available') setDismissed(false);
    });

    return cleanup;
  }, [isElectron]);

  const handleCheckUpdate = useCallback(async () => {
    if (!isElectron) return;
    setStatus({ status: 'checking' });
    await window.electronAPI!.checkForUpdate();
  }, [isElectron]);

  const handleDownload = useCallback(async () => {
    if (!isElectron) return;
    await window.electronAPI!.downloadUpdate();
  }, [isElectron]);

  const handleInstall = useCallback(() => {
    if (!isElectron) return;
    window.electronAPI!.installUpdate();
  }, [isElectron]);

  // 不在 Electron 环境中不渲染
  if (!isElectron) return null;

  // 没有更新状态或已关闭且不是正在下载/已下载
  if (!status || (dismissed && status.status !== 'downloading' && status.status !== 'downloaded')) return null;

  // 已经是最新版，不显示
  if (status.status === 'up-to-date' || status.status === 'checking') return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-sm animate-in slide-in-from-bottom-4">
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
              <ArrowUpCircle className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">{t('updater.title')}</p>
              {appVersion && <p className="text-xs text-slate-500">{t('updater.currentVersion', { version: appVersion })}</p>}
            </div>
          </div>
          {status.status !== 'downloading' && (
            <button onClick={() => setDismissed(true)} className="p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          {/* 有新版本可用 */}
          {status.status === 'available' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-400">
                  <Download className="w-3 h-3" />
                  v{status.version}
                </span>
                <span className="text-xs text-slate-400">{t('updater.newVersion')}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-sm font-semibold hover:from-cyan-500 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20"
                >
                  <Download className="w-4 h-4" />
                  {t('updater.downloadNow')}
                </button>
                <button
                  onClick={() => setDismissed(true)}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-slate-400 text-sm hover:bg-slate-700 hover:text-slate-300 transition-colors"
                >
                  {t('updater.later')}
                </button>
              </div>
            </div>
          )}

          {/* 下载中 */}
          {status.status === 'downloading' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                  {t('updater.downloading')}
                </span>
                <span className="text-cyan-400 font-semibold tabular-nums">{status.percent || 0}%</span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${status.percent || 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{status.transferred ? formatBytes(status.transferred) : '0 B'} / {status.total ? formatBytes(status.total) : '...'}</span>
                <span>{status.bytesPerSecond ? `${formatBytes(status.bytesPerSecond)}/s` : ''}</span>
              </div>
            </div>
          )}

          {/* 下载完成 */}
          {status.status === 'downloaded' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">{t('updater.ready')}</span>
              </div>
              <button
                onClick={handleInstall}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-green-600 text-white text-sm font-semibold hover:from-emerald-500 hover:to-green-500 transition-all shadow-lg shadow-emerald-500/20"
              >
                <RefreshCw className="w-4 h-4" />
                {t('updater.installRestart')}
              </button>
              <p className="text-xs text-slate-500 text-center">{t('updater.installHint')}</p>
            </div>
          )}

          {/* 错误 */}
          {status.status === 'error' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-red-400">
                <XCircle className="w-4 h-4" />
                <span className="font-medium">{t('updater.error')}</span>
              </div>
              <p className="text-xs text-slate-500">{status.message}</p>
              <button
                onClick={handleCheckUpdate}
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                {t('updater.retry')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 手动检查更新按钮 (供设置页面使用) ====================
export function CheckUpdateButton() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState('');
  const isElectron = !!window.electronAPI?.isElectron;

  if (!isElectron) return null;

  const handleCheck = async () => {
    setChecking(true);
    setResult('');
    try {
      const res = await window.electronAPI!.checkForUpdate();
      if (res.status === 'ok' && res.version) {
        setResult(t('updater.foundVersion', { version: res.version }));
      } else if (res.status === 'error') {
        setResult(`❌ ${res.message}`);
      } else {
        setResult(t('updater.alreadyLatest'));
      }
    } catch {
      setResult(t('updater.checkFailed'));
    }
    setChecking(false);
    setTimeout(() => setResult(''), 8000);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleCheck}
        disabled={checking}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors disabled:opacity-50"
      >
        {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {t('updater.checkUpdate')}
      </button>
      {result && <span className="text-xs text-slate-400">{result}</span>}
    </div>
  );
}
