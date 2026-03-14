import { useState } from 'react';
import { Download, Upload, Trash2, Info, HardDrive, Timer, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import { useStore } from '../store/useStore';
import { useIsMobile } from '../hooks/useIsMobile';

const INTERVAL_OPTIONS = [
  { label: '3秒 ⚠️ 高频', value: 3000 },
  { label: '5秒', value: 5000 },
  { label: '10秒', value: 10000 },
  { label: '15秒', value: 15000 },
  { label: '30秒', value: 30000 },
  { label: '1分钟', value: 60000 },
  { label: '2分钟', value: 120000 },
  { label: '5分钟', value: 300000 },
];

function formatInterval(ms: number): string {
  if (ms < 60000) return `${ms / 1000}秒`;
  return `${ms / 60000}分钟`;
}

export default function Settings() {
  const { refreshIntervals, setRefreshIntervals } = useStore();
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const [exportMsg, setExportMsg] = useState('');

  const handleExport = async () => {
    try {
      const data = {
        apiConfigs: await db.apiConfigs.toArray(),
        strategies: await db.strategies.toArray(),
        gridOrders: await db.gridOrders.toArray(),
        tradeRecords: await db.tradeRecords.toArray(),
        equitySnapshots: await db.equitySnapshots.toArray(),
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
        if (data.strategies) {
          await db.strategies.clear();
          await db.strategies.bulkAdd(data.strategies.map((s: any) => { const { id, ...rest } = s; return rest; }));
        }
        if (data.gridOrders) {
          await db.gridOrders.clear();
          await db.gridOrders.bulkAdd(data.gridOrders.map((o: any) => { const { id, ...rest } = o; return rest; }));
        }
        if (data.tradeRecords) {
          await db.tradeRecords.clear();
          await db.tradeRecords.bulkAdd(data.tradeRecords.map((t: any) => { const { id, ...rest } = t; return rest; }));
        }
        if (data.equitySnapshots) {
          await db.equitySnapshots.clear();
          await db.equitySnapshots.bulkAdd(data.equitySnapshots.map((s: any) => { const { id, ...rest } = s; return rest; }));
        }
        setExportMsg(t('common.success'));
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
      setExportMsg(`已使用 ${used} MB / ${quota} MB`);
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
          {isMobile ? '配置自动刷新频率，间隔越短 API 请求越多。' : '配置各模块的自动刷新频率。间隔越短数据越实时，但会增加 API 请求频率。'}
        </p>
        <div className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-xl ${isMobile ? 'text-xs' : 'text-sm'} text-amber-400/80 space-y-1`} style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.06) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(234,179,8,0.12)' }}>
          <p className="font-medium">⚠️ API 频率限制提醒</p>
          {!isMobile && (
            <p className="text-amber-400/60">
              Binance: 1200次/分 · OKX: 20次/2秒 · Bybit: 10次/秒 · Gate: 900次/分 · KuCoin: 30次/3秒 · MEXC: 2次/秒(签名)
            </p>
          )}
          <p className="text-amber-400/60">
            {isMobile ? '多策略运行时请适当增大间隔，避免触发限流。' : '每个策略每次刷新约需 2-3 次 API 请求。多策略运行时请适当增大间隔，避免触发限流 (HTTP 429) 导致下单失败。'}
          </p>
        </div>
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-1 md:grid-cols-3 gap-4'}`}>
          {([
            { key: 'strategy' as const, label: '策略监控', desc: '订单状态、持仓、风控检查', icon: '⚡' },
            { key: 'market' as const, label: '市场行情', desc: '价格、涨跌幅、成交量', icon: '📊' },
            { key: 'account' as const, label: '账户资产', desc: '余额、持仓估值', icon: '💰' },
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
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-sm text-slate-600 text-center">
                当前: {formatInterval(refreshIntervals[key])}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Security */}
      <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold`}>{t('settings.security')}</h3>
        <div className="space-y-3 text-sm text-slate-400">
          <div className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(16,185,129,0.1)' }}>
            <span className="text-emerald-400 mt-0.5 text-sm">✓</span>
            <div>
              <p className="text-slate-200 font-medium text-sm">纯本地运行</p>
              <p className="text-slate-400 text-sm mt-0.5">所有数据和交易逻辑都在您的浏览器中运行，不经过任何中间服务器。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(16,185,129,0.1)' }}>
            <span className="text-emerald-400 mt-0.5 text-sm">✓</span>
            <div>
              <p className="text-slate-200 font-medium text-sm">API Key 加密存储</p>
              <p className="text-slate-400 text-sm mt-0.5">API Secret 使用 AES-256 加密后存储在本地 IndexedDB 中。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(16,185,129,0.1)' }}>
            <span className="text-emerald-400 mt-0.5 text-sm">✓</span>
            <div>
              <p className="text-slate-200 font-medium text-sm">仅需交易权限</p>
              <p className="text-slate-400 text-sm mt-0.5">API Key 仅需开启现货交易权限，请勿开启提币权限。建议设置 IP 白名单。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(15,23,42,0.3) 100%)', border: '1px solid rgba(16,185,129,0.1)' }}>
            <span className="text-emerald-400 mt-0.5 text-sm">✓</span>
            <div>
              <p className="text-slate-200 font-medium text-sm">PWA 支持</p>
              <p className="text-slate-400 text-sm mt-0.5">可添加到手机桌面使用，支持离线访问（交易功能需联网）。</p>
            </div>
          </div>
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

      {/* About */}
      <div className={`card ${isMobile ? 'space-y-2' : 'space-y-3'}`}>
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold`}>{t('settings.about')}</h3>
        <div className="text-sm text-slate-400 space-y-1">
          <p><span className="text-slate-300">产品名称:</span> Apex Adaptive Grid System</p>
          <p><span className="text-slate-300">版本:</span> 1.0.0</p>
          <p><span className="text-slate-300">定位:</span> 面向专业用户的自适应波动率三层网格量化系统</p>
          <p><span className="text-slate-300">目标:</span> 长期生存和稳定复利，而不是短期暴利</p>
        </div>
      </div>
    </div>
  );
}
