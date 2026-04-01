import { useState, useEffect } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { startVersionCheck, hasNewVersion, getLatestVersion, getLocalVersion } from '../services/versionCheck';
import { useTranslation } from 'react-i18next';

export default function UpdateBanner() {
  const { i18n } = useTranslation();
  const isZh = i18n.language === 'zh' || i18n.language?.startsWith('zh');
  const [showBanner, setShowBanner] = useState(false);
  const [latestVer, setLatestVer] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    startVersionCheck((latest) => {
      setLatestVer(latest);
      setShowBanner(true);
    });
  }, []);

  // 定期检查状态（用于首次加载后延迟回调的情况）
  useEffect(() => {
    const timer = setInterval(() => {
      if (hasNewVersion() && !dismissed) {
        setLatestVer(getLatestVersion() || '');
        setShowBanner(true);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [dismissed]);

  if (!showBanner || dismissed) return null;

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const currentVer = getLocalVersion();

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-blue-600/95 to-cyan-600/95 backdrop-blur-sm border-b border-blue-400/20 shadow-lg">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <ArrowUpCircle className="w-5 h-5 text-white shrink-0 animate-pulse" />
          <p className="text-sm text-white font-medium truncate">
            {isZh
              ? `🎉 新版本 v${latestVer} 已发布！当前版本 v${currentVer}`
              : `🎉 New version v${latestVer} available! Current: v${currentVer}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isElectron ? (
            <a
              href="https://alphinel.com/grid"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-white text-blue-700 hover:bg-blue-50 transition-colors"
            >
              {isZh ? '去下载' : 'Download'}
            </a>
          ) : (
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-white text-blue-700 hover:bg-blue-50 transition-colors"
            >
              {isZh ? '刷新更新' : 'Refresh to update'}
            </button>
          )}
          <button
            onClick={() => { setDismissed(true); setShowBanner(false); }}
            className="p-1 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            title={isZh ? '稍后提醒' : 'Remind later'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
