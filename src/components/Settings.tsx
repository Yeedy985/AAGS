import { useState } from 'react';
import { Download, Upload, Trash2, Info, HardDrive, Timer, Globe, ArrowUpCircle, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import { useStore } from '../store/useStore';
import { useIsMobile } from '../hooks/useIsMobile';

const INTERVAL_KEYS: { key: string; value: number }[] = [
  { key: 'interval3s', value: 3000 },
  { key: 'interval5s', value: 5000 },
  { key: 'interval10s', value: 10000 },
  { key: 'interval15s', value: 15000 },
  { key: 'interval30s', value: 30000 },
  { key: 'interval1m', value: 60000 },
  { key: 'interval2m', value: 120000 },
  { key: 'interval5m', value: 300000 },
];

export default function Settings() {
  const { refreshIntervals, setRefreshIntervals, setActiveTab } = useStore();
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const [exportMsg, setExportMsg] = useState('');

  const handleExport = async () => {
    try {
      // 导出所有 IndexedDB 表
      const data = {
        apiConfigs: await db.apiConfigs.toArray(),
        strategies: await db.strategies.toArray(),
        gridOrders: await db.gridOrders.toArray(),
        tradeRecords: await db.tradeRecords.toArray(),
        equitySnapshots: await db.equitySnapshots.toArray(),
        signalDefinitions: await db.signalDefinitions.toArray(),
        signalEvents: await db.signalEvents.toArray(),
        scoringResults: await db.scoringResults.toArray(),
        eventAlerts: await db.eventAlerts.toArray(),
        llmConfigs: await db.llmConfigs.toArray(),
        notificationConfigs: await db.notificationConfigs.toArray(),
        publicServiceConfigs: await db.publicServiceConfigs.toArray(),
        scanBriefings: await db.scanBriefings.toArray(),
        scanFailures: await db.scanFailures.toArray(),
        tradeContexts: await db.tradeContexts.toArray(),
        // 导出 localStorage 设置
        localStorage: {
          aags_language: localStorage.getItem('aags_language'),
          aags_active_tab: localStorage.getItem('aags_active_tab'),
          aags_enc_key: localStorage.getItem('aags_enc_key'),
          aags_share_codes: localStorage.getItem('aags_share_codes'),
          aags_min_display_value: localStorage.getItem('aags_min_display_value'),
          aags_push_settings: localStorage.getItem('aags_push_settings'),
          aags_report_mode: localStorage.getItem('aags_report_mode'),
          aags_auto_scan: localStorage.getItem('aags_auto_scan'),
          'aags-refresh-intervals': localStorage.getItem('aags-refresh-intervals'),
        },
        exportVersion: '1.0.2',
        exportTime: Date.now(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aags-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(t('common.success'));
      setTimeout(() => setExportMsg(''), 3000);
    } catch (err: any) {
      setExportMsg(`${t('common.failed')}: ${err.message}`);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const strip = (arr: any[]) => arr.map((item: any) => { const { id, ...rest } = item; return rest; });

        // 恢复所有 IndexedDB 表
        const tables: { key: string; table: any }[] = [
          { key: 'apiConfigs', table: db.apiConfigs },
          { key: 'strategies', table: db.strategies },
          { key: 'gridOrders', table: db.gridOrders },
          { key: 'tradeRecords', table: db.tradeRecords },
          { key: 'equitySnapshots', table: db.equitySnapshots },
          { key: 'signalDefinitions', table: db.signalDefinitions },
          { key: 'signalEvents', table: db.signalEvents },
          { key: 'scoringResults', table: db.scoringResults },
          { key: 'eventAlerts', table: db.eventAlerts },
          { key: 'llmConfigs', table: db.llmConfigs },
          { key: 'notificationConfigs', table: db.notificationConfigs },
          { key: 'publicServiceConfigs', table: db.publicServiceConfigs },
          { key: 'scanBriefings', table: db.scanBriefings },
          { key: 'scanFailures', table: db.scanFailures },
          { key: 'tradeContexts', table: db.tradeContexts },
        ];

        for (const { key, table } of tables) {
          if (data[key] && Array.isArray(data[key]) && data[key].length > 0) {
            await table.clear();
            await table.bulkAdd(strip(data[key]));
          }
        }

        // 恢复 localStorage 设置
        if (data.localStorage && typeof data.localStorage === 'object') {
          for (const [k, v] of Object.entries(data.localStorage)) {
            if (v !== null && v !== undefined) {
              localStorage.setItem(k, v as string);
            }
          }
        }

        setExportMsg(t('common.success'));
        setTimeout(() => window.location.reload(), 1500);
      } catch (err: any) {
        setExportMsg(`${t('common.failed')}: ${err.message}`);
      }
    };
    input.click();
  };

  const handleClearAll = async () => {
    if (!confirm(t('settings.clearConfirm'))) return;
    await db.delete();
    window.location.reload();
  };

  const estimateStorage = async () => {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const used = ((est.usage || 0) / 1024 / 1024).toFixed(2);
      const quota = ((est.quota || 0) / 1024 / 1024).toFixed(0);
      setExportMsg(t('settings.storageUsed', { used, quota }));
      setTimeout(() => setExportMsg(''), 5000);
    }
  };

  return (
    <div className={isMobile ? 'space-y-4' : 'space-y-6'}>
      <h1 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>{t('settings.title')}</h1>

      {/* Data Management */}
      <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
          <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)' }}>
            <HardDrive className={`${isMobile ? 'w-4 h-4' : 'w-4.5 h-4.5'} text-blue-400`} />
          </div>
          {t('settings.dataManagement')}
        </h3>
        <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>
          {t('settings.securityDesc')}
        </p>
        <div className={`flex flex-wrap ${isMobile ? 'gap-2' : 'gap-3'}`}>
          <button className={`btn-primary flex items-center gap-1.5 ${isMobile ? 'text-xs' : ''}`} onClick={handleExport}>
            <Download className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> {t('settings.exportData')}
          </button>
          <button className={`btn-secondary flex items-center gap-1.5 ${isMobile ? 'text-xs' : ''}`} onClick={handleImport}>
            <Upload className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> {t('settings.importData')}
          </button>
          <button className={`btn-secondary flex items-center gap-1.5 ${isMobile ? 'text-xs' : ''}`} onClick={estimateStorage}>
            <Info className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> Storage
          </button>
          <button className={`btn-danger flex items-center gap-1.5 ${isMobile ? 'text-xs' : ''}`} onClick={handleClearAll}>
            <Trash2 className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> {t('settings.clearAllData')}
          </button>
        </div>
        {exportMsg && <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-blue-400`}>{exportMsg}</p>}
      </div>

      {/* Refresh Intervals */}
      <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
          <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.05) 100%)' }}>
            <Timer className={`${isMobile ? 'w-4 h-4' : 'w-4.5 h-4.5'} text-violet-400`} />
          </div>
          {t('settings.refreshInterval')}
        </h3>
        <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>
          {isMobile ? t('settings.refreshDescMobile') : t('settings.refreshDesc')}
        </p>
        <div className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-xl ${isMobile ? 'text-xs' : 'text-sm'} text-amber-400/80 space-y-1`} style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.06) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(234,179,8,0.12)' }}>
          <p className="font-medium">{t('settings.apiRateWarning')}</p>
          {!isMobile && (
            <p className="text-amber-400/60">
              {t('settings.apiRateDetails')}
            </p>
          )}
          <p className="text-amber-400/60">
            {isMobile ? t('settings.apiRateHintMobile') : t('settings.apiRateHint')}
          </p>
        </div>
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-1 md:grid-cols-3 gap-4'}`}>
          {([
            { key: 'strategy' as const, label: t('settings.intervalStrategy'), desc: t('settings.intervalStrategyDesc'), icon: '⚡' },
            { key: 'market' as const, label: t('settings.intervalMarket'), desc: t('settings.intervalMarketDesc'), icon: '📊' },
            { key: 'account' as const, label: t('settings.intervalAccount'), desc: t('settings.intervalAccountDesc'), icon: '💰' },
          ]).map(({ key, label, desc, icon }) => (
            <div key={key} className={`${isMobile ? 'p-3 space-y-2' : 'p-4 space-y-3'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.6) 0%, rgba(30,41,59,0.3) 100%)', border: '1px solid rgba(51,65,85,0.3)' }}>
              <div className="flex items-center gap-2">
                <span className={isMobile ? 'text-base' : 'text-lg'}>{icon}</span>
                <div>
                  <p className={`font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{label}</p>
                  <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{desc}</p>
                </div>
              </div>
              <select
                className="select-field text-sm w-full"
                value={refreshIntervals[key]}
                onChange={(e) => setRefreshIntervals({ [key]: Number(e.target.value) })}
              >
                {INTERVAL_KEYS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{t(`settings.${opt.key}`)}</option>
                ))}
              </select>
              <p className="text-sm text-slate-600 text-center">
                {t('settings.currentInterval', { value: INTERVAL_KEYS.find(o => o.value === refreshIntervals[key]) ? t(`settings.${INTERVAL_KEYS.find(o => o.value === refreshIntervals[key])!.key}`) : `${refreshIntervals[key] / 1000}s` })}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Security */}
      <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold`}>{t('settings.security')}</h3>
        <div className="space-y-3 text-sm text-slate-400">
          {(['securityLocal', 'securityEncrypt', 'securityPermission', 'securityPwa'] as const).map((key) => (
            <div key={key} className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(16,185,129,0.1)' }}>
              <span className="text-emerald-400 mt-0.5 text-sm">✓</span>
              <div>
                <p className="text-slate-200 font-medium text-sm">{t(`settings.${key}`)}</p>
                <p className="text-slate-400 text-sm mt-0.5">{t(`settings.${key}Desc`)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
          <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%)' }}>
            <Globe className={`${isMobile ? 'w-4 h-4' : 'w-4.5 h-4.5'} text-cyan-400`} />
          </div>
          {t('settings.language')}
        </h3>
        <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('settings.languageDesc')}</p>
        <div className="flex gap-2">
          <button
            onClick={() => { i18n.changeLanguage('zh'); localStorage.setItem('aags_language', 'zh'); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${i18n.language === 'zh' || i18n.language?.startsWith('zh') ? 'bg-cyan-600/20 border border-cyan-500/40 text-cyan-400' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'}`}
          >
            中文
          </button>
          <button
            onClick={() => { i18n.changeLanguage('en'); localStorage.setItem('aags_language', 'en'); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${i18n.language === 'en' ? 'bg-cyan-600/20 border border-cyan-500/40 text-cyan-400' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'}`}
          >
            English
          </button>
        </div>
      </div>

      {/* Version Update */}
      <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
          <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%)' }}>
            <ArrowUpCircle className={`${isMobile ? 'w-4 h-4' : 'w-4.5 h-4.5'} text-cyan-400`} />
          </div>
          {t('settings.versionUpdate')}
        </h3>
        <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('settings.versionUpdateDesc')}</p>
        <button
          onClick={() => setActiveTab('version')}
          className={`w-full flex items-center justify-between ${isMobile ? 'p-3' : 'p-4'} rounded-xl transition-all hover:bg-slate-700/30`}
          style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.6) 0%, rgba(30,41,59,0.3) 100%)', border: '1px solid rgba(51,65,85,0.3)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
              <ArrowUpCircle className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="text-left">
              <p className={`${isMobile ? 'text-sm' : ''} font-medium text-slate-200`}>{t('settings.checkVersionUpdate')}</p>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-0.5`}>{t('settings.checkVersionUpdateDesc')}</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {/* About */}
      <div className={`card ${isMobile ? 'space-y-2' : 'space-y-3'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold`}>{t('settings.about')}</h3>
        <div className="text-sm text-slate-400 space-y-1">
          <p><span className="text-slate-300">{t('settings.aboutName')}:</span> Apex Adaptive Grid System</p>
          <p><span className="text-slate-300">{t('settings.aboutVersion')}:</span> 1.0.2</p>
          <p><span className="text-slate-300">{t('settings.aboutPosition')}:</span> {t('settings.aboutPositionDesc')}</p>
          <p><span className="text-slate-300">{t('settings.aboutGoal')}:</span> {t('settings.aboutGoalDesc')}</p>
        </div>
      </div>
    </div>
  );
}
