import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, CheckCircle, AlertCircle, Loader2, RefreshCw, Tag, Clock, FileText, ArrowUpCircle, ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useIsMobile } from '../hooks/useIsMobile';

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  html_url: string;
  assets: {
    name: string;
    browser_download_url: string;
    size: number;
  }[];
}

const GITHUB_OWNER = 'Yeedy985';
const GITHUB_REPO = 'AAGS';
const CURRENT_VERSION = '1.0.1';

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function formatDate(dateStr: string, lang: string): string {
  const d = new Date(dateStr);
  if (lang === 'zh' || lang.startsWith('zh')) {
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  }
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseChangelog(body: string): { type: string; text: string }[] {
  if (!body) return [];
  const lines = body.split('\n');
  const items: { type: string; text: string }[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Parse markdown list items: "- 🐛 Fixed ..." or "- **fix**: ..."
    const match = trimmed.match(/^[-*]\s*(.+)$/);
    if (match) {
      const content = match[1];
      let type = 'other';
      if (/🐛|bug|fix|修复|修正/i.test(content)) type = 'fix';
      else if (/✨|feat|feature|新增|新功能|添加/i.test(content)) type = 'feature';
      else if (/🔧|improve|优化|改进|提升/i.test(content)) type = 'improve';
      else if (/⚠️|break|重大/i.test(content)) type = 'breaking';
      items.push({ type, text: content });
    }
  }
  return items;
}

const typeConfig: Record<string, { label: string; labelEn: string; color: string; bg: string }> = {
  fix: { label: '修复', labelEn: 'Fix', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  feature: { label: '新增', labelEn: 'New', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  improve: { label: '优化', labelEn: 'Improve', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  breaking: { label: '重大', labelEn: 'Breaking', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  other: { label: '其他', labelEn: 'Other', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' },
};

export default function VersionUpdate() {
  const { setActiveTab } = useStore();
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh' || i18n.language?.startsWith('zh');

  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`);
      if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
      const data: GitHubRelease[] = await resp.json();
      setReleases(data.filter(r => !r.prerelease));
    } catch (err: any) {
      setError(err.message || t('version.fetchFailed'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  const latestVersion = releases.length > 0 ? releases[0].tag_name.replace(/^v/, '') : CURRENT_VERSION;
  const hasUpdate = isNewer(latestVersion, CURRENT_VERSION);

  const handleUpdate = async () => {
    if (isElectron) {
      setUpdating(true);
      setUpdateMsg(t('version.checkingElectron'));
      try {
        const res = await window.electronAPI!.checkForUpdate();
        if (res.status === 'ok' && res.version) {
          setUpdateMsg(t('version.downloadingElectron'));
          await window.electronAPI!.downloadUpdate();
        } else {
          setUpdateMsg(t('version.alreadyLatest'));
          setTimeout(() => setUpdateMsg(''), 3000);
        }
      } catch (err: any) {
        setUpdateMsg(`❌ ${err.message}`);
      }
      setUpdating(false);
    } else {
      // Web/PWA: reload to get latest version from service worker
      setUpdating(true);
      setUpdateMsg(t('version.updatingWeb'));
      // Unregister service worker and reload
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      // Clear caches
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      }
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  };

  return (
    <div className={isMobile ? 'space-y-4' : 'space-y-6'}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveTab('settings')}
          className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
        >
          <ArrowLeft className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
        </button>
        <div>
          <h1 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>
            {t('version.title')}
          </h1>
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-0.5`}>
            {t('version.currentVersion')}: v{CURRENT_VERSION}
          </p>
        </div>
      </div>

      {/* Update Available Banner */}
      {hasUpdate && !loading && (
        <div className={`${isMobile ? 'p-4' : 'p-5'} rounded-2xl overflow-hidden relative`} style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.12) 0%, rgba(59,130,246,0.08) 50%, rgba(139,92,246,0.06) 100%)', border: '1px solid rgba(6,182,212,0.2)', boxShadow: '0 0 30px -8px rgba(6,182,212,0.15)' }}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
              <ArrowUpCircle className="w-6 h-6 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-white`}>{t('version.newVersionAvailable')}</h3>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-xs font-semibold text-cyan-400">
                  v{latestVersion}
                </span>
              </div>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400 mb-3`}>
                {t('version.updateDesc')}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleUpdate}
                  disabled={updating}
                  className={`flex items-center gap-2 ${isMobile ? 'px-4 py-2 text-xs' : 'px-5 py-2.5 text-sm'} rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-semibold hover:from-cyan-500 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50`}
                >
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {t('version.updateNow')}
                </button>
                {updateMsg && <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-cyan-400`}>{updateMsg}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Already Latest */}
      {!hasUpdate && !loading && releases.length > 0 && (
        <div className={`${isMobile ? 'p-4' : 'p-5'} rounded-2xl flex items-center gap-3`} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(16,185,129,0.15)' }}>
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <p className={`${isMobile ? 'text-sm' : ''} font-medium text-emerald-400`}>{t('version.upToDate')}</p>
            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-0.5`}>{t('version.upToDateDesc')}</p>
          </div>
          <button
            onClick={fetchReleases}
            className="ml-auto p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
            title={t('version.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className={`card ${isMobile ? 'py-10' : 'py-16'} flex flex-col items-center gap-3`}>
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('version.loading')}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={`card ${isMobile ? 'p-3' : 'p-4'} flex items-center gap-3`}>
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div className="flex-1">
            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-red-400`}>{t('version.fetchFailed')}: {error}</p>
          </div>
          <button onClick={fetchReleases} className="text-sm text-cyan-400 hover:text-cyan-300">{t('version.retry')}</button>
        </div>
      )}

      {/* Release History */}
      {!loading && releases.length > 0 && (
        <div className={`card ${isMobile ? 'space-y-0 p-0' : 'space-y-0 p-0'}`}>
          <div className={`${isMobile ? 'px-4 py-3' : 'px-5 py-4'} border-b border-slate-700/40`}>
            <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.05) 100%)' }}>
                <FileText className={`${isMobile ? 'w-4 h-4' : 'w-4.5 h-4.5'} text-violet-400`} />
              </div>
              {t('version.releaseHistory')}
            </h3>
          </div>

          <div className="divide-y divide-slate-700/30">
            {releases.map((release, idx) => {
              const version = release.tag_name.replace(/^v/, '');
              const isCurrent = version === CURRENT_VERSION;
              const isLatest = idx === 0;
              const items = parseChangelog(release.body);
              const exeAsset = release.assets.find(a => a.name.endsWith('.exe'));

              return (
                <div key={release.tag_name} className={`${isMobile ? 'px-4 py-4' : 'px-5 py-5'}`}>
                  {/* Version Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${isLatest ? 'text-cyan-400' : 'text-slate-500'}`} />
                      <span className={`${isMobile ? 'text-sm' : 'text-base'} font-bold ${isLatest ? 'text-white' : 'text-slate-300'}`}>
                        v{version}
                      </span>
                      {release.name && release.name !== release.tag_name && (
                        <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>— {release.name}</span>
                      )}
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400">
                          {t('version.current')}
                        </span>
                      )}
                      {isLatest && !isCurrent && (
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-medium text-cyan-400">
                          {t('version.latest')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-slate-600" />
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>
                        {formatDate(release.published_at, i18n.language)}
                      </span>
                    </div>
                  </div>

                  {/* Changelog Items */}
                  {items.length > 0 ? (
                    <div className="space-y-1.5 ml-1">
                      {items.map((item, i) => {
                        const cfg = typeConfig[item.type] || typeConfig.other;
                        return (
                          <div key={i} className="flex items-start gap-2">
                            <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
                              {isZh ? cfg.label : cfg.labelEn}
                            </span>
                            <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-300 leading-relaxed`}>
                              {item.text.replace(/^(🐛|✨|🔧|⚠️)\s*/, '')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : release.body ? (
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400 whitespace-pre-wrap ml-1`}>
                      {release.body.slice(0, 500)}
                    </p>
                  ) : (
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 ml-1`}>{t('version.noChangelog')}</p>
                  )}

                  {/* Download EXE link (doesn't interfere with web update) */}
                  {exeAsset && (
                    <div className={`mt-3 flex items-center gap-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>
                      <a
                        href={exeAsset.browser_download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-slate-500 hover:text-cyan-400 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {t('version.downloadExe')} ({formatBytes(exeAsset.size)})
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No Releases */}
      {!loading && !error && releases.length === 0 && (
        <div className={`card ${isMobile ? 'py-10' : 'py-16'} text-center`}>
          <p className={`text-slate-500 ${isMobile ? 'text-sm' : ''}`}>{t('version.noReleases')}</p>
        </div>
      )}
    </div>
  );
}
