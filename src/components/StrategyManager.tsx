import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Loader2, AlertCircle, Share2, X as XIcon, RefreshCw, Edit3 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { db } from '../db';
import type { Strategy } from '../types';
import StrategyCreator from './StrategyCreator';
import StrategyDetail from './StrategyDetail';
import StrategyPlaza from './StrategyPlaza';
import { startStrategy, stopStrategy, stopStrategyWithoutCancel, pauseStrategy, resumeStrategy, setExecutorCallbacks, updateStrategyProfit, repairMissingTradeRecords, syncAllStrategiesOrders } from '../services/strategyExecutor';
import { shareStrategy, unshareStrategy } from '../services/strategyPlazaService';
import { useIsMobile } from '../hooks/useIsMobile';

function formatRuntime(startedAt: number | undefined, t: (key: string) => string): string {
  if (!startedAt) return '--';
  const diff = Date.now() - startedAt;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const d = t('strategy.runtimeFormat.days');
  const h = t('strategy.runtimeFormat.hours');
  const m = t('strategy.runtimeFormat.minutes');
  if (days > 0) return `${days}${d} ${hours}${h} ${mins}${m}`;
  if (hours > 0) return `${hours}${h} ${mins}${m}`;
  return `${mins}${m}`;
}

export default function StrategyManager() {
  const { strategies, setStrategies, updateStrategy, removeStrategy, apiConfig, symbols, tickers } = useStore();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [showCreator, setShowCreator] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [operatingIds, setOperatingIds] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<Record<number, string[]>>({});
  const [orderTab, setOrderTab] = useState<Record<number, 'placed' | 'filled' | 'pending' | null>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [stopConfirm, setStopConfirm] = useState<{ strategy: Strategy; orderCount: number } | null>(null);

  // 实时查询所有策略的 gridOrders
  const allGridOrders = useLiveQuery(
    () => db.gridOrders.toArray(),
    [],
    []
  );

  // 实时查询所有策略的 tradeRecords
  const allTradeRecords = useLiveQuery(
    () => db.tradeRecords.toArray(),
    [],
    []
  );

  // 诊断日志: 每次数据变化时打印
  useEffect(() => {
    if (allTradeRecords.length > 0 || allGridOrders.length > 0) {
      console.log(`[诊断] tradeRecords: ${allTradeRecords.length}条, gridOrders: ${allGridOrders.length}条, strategies: ${strategies.length}个, apiConfig: ${apiConfig ? '有' : '无'}`);
      allTradeRecords.forEach(t => console.log(`  [TR] id=${t.id} side=${t.side} layer=${t.layer} grid=${t.gridIndex} price=${t.price} qty=${t.quantity} binanceId=${t.binanceTradeId}`));
      allGridOrders.filter(o => o.status === 'filled').forEach(o => console.log(`  [GO filled] id=${o.id} side=${o.side} layer=${o.layer} grid=${o.gridIndex} price=${o.price} binanceId=${o.binanceOrderId}`));
    }
  }, [allTradeRecords.length, allGridOrders.length, strategies.length, apiConfig]);

  // 初始化执行引擎回调
  useEffect(() => {
    setExecutorCallbacks({
      onStrategyUpdate: (s) => updateStrategy(s),
      onLog: (id, msg) => {
        setLogs(prev => ({
          ...prev,
          [id]: [...(prev[id] || []).slice(-49), msg],
        }));
      },
    });
  }, [updateStrategy]);

  // 数据就绪后: 修复丢失的成交记录 + 重算利润 (只执行一次)
  const repairDone = useRef(false);
  useEffect(() => {
    if (repairDone.current || !apiConfig || strategies.length === 0) return;
    repairDone.current = true;
    (async () => {
      for (const s of strategies) {
        if (s.id) {
          try {
            await repairMissingTradeRecords(s.id, apiConfig);
            await updateStrategyProfit(s.id);
            const fresh = await db.strategies.get(s.id);
            if (fresh) updateStrategy(fresh);
            // 为 running 策略重启监控循环（页面刷新后内存中的轮询已丢失）
            if (fresh && fresh.status === 'running') {
              const si = symbols.find(sym => sym.symbol === fresh.symbol);
              await resumeStrategy(fresh.id!, apiConfig, si);
            }
          } catch (err) {
            console.error(`[修复] 策略${s.id}修复失败:`, err);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiConfig, strategies.length]);

  const getSymbolInfo = useCallback((symbol: string) => {
    return symbols.find(s => s.symbol === symbol);
  }, [symbols]);

  const handleStart = async (strategy: Strategy) => {
    if (!apiConfig) {
      setErrors(prev => ({ ...prev, [strategy.id!]: t('account.apiKeyRequired') }));
      return;
    }
    setOperatingIds(prev => new Set(prev).add(strategy.id!));
    setErrors(prev => { const n = { ...prev }; delete n[strategy.id!]; return n; });
    try {
      const symbolInfo = getSymbolInfo(strategy.symbol);
      if (strategy.status === 'paused') {
        await resumeStrategy(strategy.id!, apiConfig, symbolInfo);
      } else {
        await startStrategy(strategy, apiConfig, symbolInfo);
      }
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [strategy.id!]: err.message }));
    }
    setOperatingIds(prev => { const n = new Set(prev); n.delete(strategy.id!); return n; });
  };

  const handlePause = async (strategy: Strategy) => {
    if (!apiConfig) return;
    setOperatingIds(prev => new Set(prev).add(strategy.id!));
    try {
      await pauseStrategy(strategy.id!, apiConfig);
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [strategy.id!]: err.message }));
    }
    setOperatingIds(prev => { const n = new Set(prev); n.delete(strategy.id!); return n; });
  };

  const handleStop = (strategy: Strategy) => {
    if (!apiConfig) return;
    const orderCount = allGridOrders.filter(o => o.strategyId === strategy.id && o.status === 'placed' && !!o.binanceOrderId).length;
    setStopConfirm({ strategy, orderCount });
  };

  const handleStopConfirmCancel = async () => {
    if (!stopConfirm || !apiConfig) return;
    const { strategy } = stopConfirm;
    setStopConfirm(null);
    setOperatingIds(prev => new Set(prev).add(strategy.id!));
    try {
      await stopStrategy(strategy.id!, apiConfig);
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [strategy.id!]: err.message }));
    }
    setOperatingIds(prev => { const n = new Set(prev); n.delete(strategy.id!); return n; });
  };

  const handleStopWithoutCancel = async () => {
    if (!stopConfirm) return;
    const { strategy } = stopConfirm;
    setStopConfirm(null);
    setOperatingIds(prev => new Set(prev).add(strategy.id!));
    try {
      await stopStrategyWithoutCancel(strategy.id!);
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [strategy.id!]: err.message }));
    }
    setOperatingIds(prev => { const n = new Set(prev); n.delete(strategy.id!); return n; });
  };

  const handleDelete = async (id: number) => {
    await db.strategies.delete(id);
    await db.gridOrders.where('strategyId').equals(id).delete();
    await db.tradeRecords.where('strategyId').equals(id).delete();
    await db.equitySnapshots.where('strategyId').equals(id).delete();
    removeStrategy(id);
  };

  const handleCreated = async (strategy: Strategy) => {
    const id = await db.strategies.add(strategy);
    strategy.id = id;
    setStrategies([...strategies, strategy]);
    setShowCreator(false);
  };

  const handleEdited = async (updated: Strategy) => {
    if (!updated.id) return;
    await db.strategies.put(updated);
    updateStrategy(updated);
    // 如果策略正在运行，重启监控循环使修改生效
    if (updated.status === 'running' && apiConfig) {
      try {
        await stopStrategy(updated.id, apiConfig);
        // 短暂等待确保停止完成
        await new Promise(r => setTimeout(r, 500));
        const si = getSymbolInfo(updated.symbol);
        await startStrategy(updated, apiConfig, si);
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [updated.id!]: err.message }));
      }
    }
    setEditingStrategy(null);
  };

  // ── 分享相关 ──
  const [shareModalStrategy, setShareModalStrategy] = useState<Strategy | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareSuccess, setShareSuccess] = useState(false);
  // shareCode 映射: strategyId → shareCode (本地存储)
  const [shareCodes, setShareCodes] = useState<Record<number, string>>({});

  // 加载已保存的 shareCodes
  useEffect(() => {
    const saved = localStorage.getItem('aags_share_codes');
    if (saved) try { setShareCodes(JSON.parse(saved)); } catch {}
  }, []);
  const saveShareCode = (strategyId: number, code: string) => {
    setShareCodes(prev => {
      const next = { ...prev, [strategyId]: code };
      localStorage.setItem('aags_share_codes', JSON.stringify(next));
      return next;
    });
  };
  const removeShareCode = (strategyId: number) => {
    setShareCodes(prev => {
      const next = { ...prev };
      delete next[strategyId];
      localStorage.setItem('aags_share_codes', JSON.stringify(next));
      return next;
    });
  };

  const handleShare = async (strategy: Strategy) => {
    if (!strategy.id) return;
    setSharing(true);
    setShareError('');
    try {
      const totalGridCount = (strategy.layers || []).filter(l => l.enabled).reduce((a, l) => a + (l.gridCount || 0), 0);
      const pnlPct = strategy.totalFund > 0 ? (strategy.totalProfit / strategy.totalFund * 100) : 0;
      const runSec = strategy.startedAt ? Math.floor((Date.now() - strategy.startedAt) / 1000) : 0;

      // 构建安全的 gridConfig (不含任何敏感信息)
      const gridConfig = {
        totalFund: strategy.totalFund,
        rangeMode: strategy.rangeMode,
        upperPrice: strategy.upperPrice,
        lowerPrice: strategy.lowerPrice,
        centerPrice: strategy.centerPrice,
        atrPeriod: strategy.atrPeriod,
        atrMultiplier: strategy.atrMultiplier,
        layers: strategy.layers,
        profitAllocation: strategy.profitAllocation,
        profitRatio: strategy.profitRatio,
        profitThreshold: strategy.profitThreshold,
        trendSellAbovePercent: strategy.trendSellAbovePercent,
        trendBuyBelowPercent: strategy.trendBuyBelowPercent,
        risk: strategy.risk,
        autoRebalance: strategy.autoRebalance,
        rebalanceStepPercent: strategy.rebalanceStepPercent,
        endMode: strategy.endMode,
      };

      const result = await shareStrategy({
        symbol: strategy.symbol,
        baseAsset: strategy.baseAsset,
        quoteAsset: strategy.quoteAsset,
        strategyName: strategy.name,
        gridConfig,
        pnlUsdt: strategy.totalProfit,
        pnlPercent: pnlPct,
        runSeconds: runSec,
        matchCount: strategy.winTrades,
        totalGrids: totalGridCount,
        maxDrawdownPct: strategy.maxDrawdown,
        minInvestUsdt: strategy.totalFund,
        isRunning: strategy.status === 'running',
      });
      saveShareCode(strategy.id, result.shareCode);
      setShareModalStrategy(null);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } catch (err: any) {
      setShareError(err.message || t('strategy.shareFailed'));
    }
    setSharing(false);
  };

  const handleUnshare = async (strategyId: number) => {
    const code = shareCodes[strategyId];
    if (!code) return;
    try {
      await unshareStrategy(code);
      removeShareCode(strategyId);
    } catch (err: any) {
      alert(t('strategy.unshareFailed') + ': ' + err.message);
    }
  };

  // 从策略广场复制策略后，刷新本地列表
  const handleCopyFromPlaza = (strategy: Strategy) => {
    setStrategies([...strategies, strategy]);
  };

  const handleSyncOrders = async () => {
    if (!apiConfig || syncing) return;
    setSyncing(true);
    setSyncMsg(t('strategy.syncStarted'));
    try {
      const results = await syncAllStrategiesOrders(apiConfig, symbols, (msg) => {
        setSyncMsg(msg);
      });
      const totalPlaced = results.reduce((a, r) => a + r.placedAfter, 0);
      const repaired = results.filter(r => r.repaired).length;
      if (repaired > 0) {
        setSyncMsg(t('strategy.syncDoneRepaired', { count: results.length, placed: totalPlaced, repaired }));
      } else {
        setSyncMsg(t('strategy.syncDoneOk', { count: results.length, placed: totalPlaced }));
      }
      // 刷新策略列表
      const fresh = await db.strategies.toArray();
      setStrategies(fresh);
    } catch (err: any) {
      setSyncMsg(t('strategy.syncFailed') + ': ' + err.message);
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(''), 5000);
  };

  const statusLabels: Record<string, { text: string; class: string }> = {
    idle: { text: t('strategy.status.idle'), class: 'badge-blue' },
    running: { text: t('strategy.status.running'), class: 'badge-green' },
    paused: { text: t('strategy.status.paused'), class: 'badge-yellow' },
    stopped: { text: t('strategy.status.stopped'), class: 'bg-slate-800 text-slate-400 text-sm px-2 py-0.5 rounded-full' },
    error: { text: t('strategy.status.error'), class: 'badge-red' },
    circuit_break: { text: t('strategy.status.circuitBreak'), class: 'bg-orange-900/50 text-orange-400 text-sm px-2 py-0.5 rounded-full' },
  };

  return (
    <div className={isMobile ? 'space-y-3' : 'space-y-4'}>
      <div className="flex items-center justify-between">
        <h1 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>{t('strategy.title')}</h1>
        <div className="flex items-center gap-2">
          <button
            className={`flex items-center gap-1.5 rounded-lg font-medium transition-all ${isMobile ? 'text-xs px-3 py-2' : 'text-sm px-4 py-2'} ${syncing ? 'bg-cyan-800/50 text-cyan-300 cursor-wait' : 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 hover:text-cyan-300 border border-cyan-500/30'}`}
            onClick={handleSyncOrders}
            disabled={syncing || !apiConfig}
            title={t('strategy.syncOrdersDesc')}
          >
            <RefreshCw className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${syncing ? 'animate-spin' : ''}`} />
            {t('strategy.syncOrders')}
          </button>
          <button className={`btn-primary flex items-center gap-1.5 ${isMobile ? 'text-xs px-3 py-2' : ''}`} onClick={() => setShowCreator(true)}>
            <Plus className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
            {t('strategy.createNew')}
          </button>
        </div>
      </div>

      {/* 同步状态提示 */}
      {syncMsg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${syncing ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-300' : syncMsg.includes(t('strategy.syncFailed')) ? 'bg-red-500/10 border border-red-500/20 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'}`}>
          {syncing && <Loader2 className="w-4 h-4 animate-spin" />}
          {syncMsg}
        </div>
      )}

      {/* Strategy Creator Modal */}
      {showCreator && (
        <StrategyCreator onCreated={handleCreated} onCancel={() => setShowCreator(false)} />
      )}

      {/* Strategy Editor Modal */}
      {editingStrategy && (
        <StrategyCreator editStrategy={editingStrategy} onCreated={handleEdited} onCancel={() => setEditingStrategy(null)} />
      )}

      {/* Share Confirmation Modal */}
      {shareModalStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">{t('strategy.shareToPlaza')}</h3>
              <button onClick={() => setShareModalStrategy(null)} className="text-slate-400 hover:text-white"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-300 font-medium mb-1">{t('strategy.sharePrivacy')}</p>
              <p className="text-xs text-amber-200/70 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('strategy.sharePrivacyDesc') }} />
            </div>
            <div className="mb-4 p-3 rounded-lg bg-slate-800 text-sm">
              <p className="text-slate-400">{t('strategy.strategyLabel')}: <span className="text-white font-medium">{shareModalStrategy.name}</span></p>
              <p className="text-slate-400 mt-1">{t('strategy.tradingPair')}: <span className="text-white">{shareModalStrategy.symbol}</span></p>
              <p className="text-slate-400 mt-1">{t('strategy.investmentAmount')}: <span className="text-white">{shareModalStrategy.totalFund} USDT</span></p>
            </div>
            {shareError && <p className="text-sm text-red-400 mb-3">{shareError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setShareModalStrategy(null)}
                className="flex-1 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-300"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleShare(shareModalStrategy)}
                disabled={sharing}
                className="flex-1 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-bold text-white flex items-center justify-center gap-2"
              >
                {sharing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('strategy.confirmShare')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Success Toast */}
      {shareSuccess && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl bg-emerald-600/90 backdrop-blur-sm text-white font-medium text-sm shadow-2xl flex items-center gap-2 animate-fade-in">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          {t('strategy.shareSuccess')}
        </div>
      )}

      {/* Left-Right Split Layout */}
      <div className={`flex ${isMobile ? 'flex-col gap-4' : 'gap-6'}`} style={isMobile ? {} : { minHeight: 'calc(100vh - 180px)' }}>
        {/* Left: My Strategies */}
        <div className={isMobile ? 'w-full' : 'w-[45%] shrink-0 overflow-y-auto'}>
      {strategies.length === 0 ? (
        <div className={`card ${isMobile ? 'py-10' : 'py-16'} text-center`}>
          <p className={`text-slate-500 ${isMobile ? 'text-base' : 'text-lg'}`}>{t('strategy.noStrategies')}</p>
          <p className={`text-slate-600 ${isMobile ? 'text-xs' : 'text-sm'} mt-2`}>{t('strategy.noStrategiesDesc')}</p>
        </div>
      ) : (
        <div className={isMobile ? 'space-y-3' : 'space-y-4'}>
          {strategies.map((s) => {
            const status = statusLabels[s.status] || statusLabels.idle;
            const isExpanded = expandedId === s.id;
            const ticker = tickers.get(s.symbol);
            const latestPrice = ticker ? parseFloat(ticker.price) : 0;
            const totalGridCount = (s.layers || []).filter(l => l.enabled).reduce((a, l) => a + (l.gridCount || 0), 0);
            const perGridQty = s.totalFund > 0 && totalGridCount > 0 && latestPrice > 0
              ? (s.totalFund / totalGridCount / latestPrice)
              : 0;
            // 浮动盈亏: 从网格订单计算未平仓持仓的盈亏
            const strategyOrders = allGridOrders.filter(o => o.strategyId === s.id && o.status === 'filled');
            const filledBuys = strategyOrders.filter(o => o.side === 'buy');
            const filledSells = strategyOrders.filter(o => o.side === 'sell');
            // 找出未被卖出匹配的买入订单 = 当前持仓
            const matchedBuyKeys = new Set<string>();
            for (const sell of filledSells) {
              const matchBuy = filledBuys.find(b =>
                b.layer === sell.layer && b.gridIndex === sell.gridIndex &&
                b.createdAt < sell.createdAt && !matchedBuyKeys.has(`${b.layer}-${b.gridIndex}-${b.createdAt}`)
              );
              if (matchBuy) matchedBuyKeys.add(`${matchBuy.layer}-${matchBuy.gridIndex}-${matchBuy.createdAt}`);
            }
            let holdingQty = 0;
            let costBasis = 0;
            for (const buy of filledBuys) {
              if (!matchedBuyKeys.has(`${buy.layer}-${buy.gridIndex}-${buy.createdAt}`)) {
                holdingQty += buy.filledQuantity || buy.quantity;
                costBasis += buy.price * (buy.filledQuantity || buy.quantity);
              }
            }
            const unrealizedPnl = latestPrice > 0 ? (holdingQty * latestPrice - costBasis) : 0;
            const unrealizedPct = s.totalFund > 0 ? (unrealizedPnl / s.totalFund * 100) : 0;
            const gridProfit = s.totalProfit;
            const totalReturn = gridProfit + unrealizedPnl;
            const totalReturnPct = s.totalFund > 0 ? (totalReturn / s.totalFund * 100) : 0;
            const profitPct = s.totalFund > 0 ? (gridProfit / s.totalFund * 100) : 0;

            return (
              <div key={s.id} className={`${isMobile ? 'rounded-xl' : 'rounded-2xl'} overflow-hidden transition-all duration-300 hover:shadow-lg`} style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(10,15,30,0.85) 100%)', border: '1px solid rgba(51,65,85,0.35)', boxShadow: '0 4px 24px -4px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.02) inset' }}>
                {/* === Row 1: Symbol + Status === */}
                <div className={`flex items-center justify-between ${isMobile ? 'px-3 pt-2.5' : 'px-5 pt-4'} pb-0.5`}>
                  <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('strategy.spotGrid')}</span>
                </div>
                <div className={`flex items-center justify-between ${isMobile ? 'px-3' : 'px-5'} pb-1.5`}>
                  <h3 className={`${isMobile ? 'text-base' : 'text-xl'} font-bold`}>{s.symbol.replace('USDT', '')}/USDT</h3>
                  <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium ${
                    s.status === 'running' ? 'text-emerald-400' :
                    s.status === 'paused' ? 'text-yellow-400' :
                    s.status === 'error' ? 'text-red-400' : 'text-slate-400'
                  }`}>
                    {status.text} &gt;
                  </span>
                </div>

                {/* === Row 2: Creation time + Runtime === */}
                <div className={`${isMobile ? 'px-3 pb-2' : 'px-5 pb-4'}`}>
                  <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>
                    {isMobile
                      ? (s.startedAt ? `${t('strategy.running')} ${formatRuntime(s.startedAt, t)}` : t('strategy.notStarted'))
                      : `${t('strategy.createdTime')} ${new Date(s.createdAt).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}${s.startedAt ? `, ${t('strategy.runtime')} ${formatRuntime(s.startedAt, t)}` : ''}`
                    }
                  </p>
                </div>

                {/* === Row 3: grid — Investment / Price Range / Grid Count === */}
                <div className={`grid ${isMobile ? 'grid-cols-2 gap-x-2 gap-y-1.5 px-3' : 'grid-cols-3 gap-4 px-5'} pb-2.5`}>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? t('strategy.investmentShort') : t('strategy.totalInvestment')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{s.totalFund.toFixed(isMobile ? 2 : 5)}</p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? t('strategy.priceRangeShort') : t('strategy.priceRange')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{s.lowerPrice.toFixed(isMobile ? 2 : 5)} - {s.upperPrice.toFixed(isMobile ? 2 : 5)}</p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{t('strategy.gridCount')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{totalGridCount}</p>
                  </div>
                  {isMobile && (
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">{t('strategy.latestPrice')}</p>
                      <p className="text-xs font-semibold">{latestPrice > 0 ? latestPrice.toFixed(latestPrice < 1 ? 5 : 2) : '--'}</p>
                    </div>
                  )}
                </div>

                {/* === Row 4: Total Profit / Grid Profit / Unrealized PnL === */}
                <div className={`grid grid-cols-3 ${isMobile ? 'gap-1 px-3' : 'gap-4 px-5'} pb-2.5`}>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? t('strategy.totalReturnShort') : t('strategy.totalReturn')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(isMobile ? 2 : 5)}
                    </p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalReturn >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? t('strategy.gridProfitShort') : t('strategy.gridProfit')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold ${gridProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gridProfit >= 0 ? '+' : ''}{gridProfit.toFixed(isMobile ? 2 : 5)}
                    </p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} ${gridProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gridProfit >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? t('strategy.unrealizedPnlShort') : t('strategy.unrealizedPnl')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold ${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(isMobile ? 2 : 5)}
                    </p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} ${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPct.toFixed(2)}%
                    </p>
                  </div>
                </div>

                {/* === Row 5: Qty per trade / Matched count / Latest price === */}
                <div className={`grid ${isMobile ? 'grid-cols-2 gap-1 px-3' : 'grid-cols-3 gap-4 px-5'} pb-3`}>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? t('strategy.qtyPerTrade') : `${t('strategy.qtyPerTrade')} (${s.baseAsset})`}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{perGridQty > 0 ? perGridQty.toFixed(perGridQty < 1 ? 5 : 2) : '--'}</p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{t('strategy.matchPair')}</p>
                    {(() => {
                      const trades = allTradeRecords.filter(t => t.strategyId === s.id);
                      // FIFO 配对: 和 updateStrategyProfit 保持一致
                      const pairGroups = new Map<string, typeof trades>();
                      for (const t of trades) {
                        const k = `${t.layer}_${t.gridIndex}`;
                        const arr = pairGroups.get(k) || [];
                        arr.push(t);
                        pairGroups.set(k, arr);
                      }
                      let pairs = 0;
                      for (const [, group] of pairGroups) {
                        group.sort((a, b) => a.timestamp - b.timestamp);
                        const buyStack: typeof trades = [];
                        for (const t of group) {
                          if (t.side === 'buy') buyStack.push(t);
                          else if (t.side === 'sell' && buyStack.length > 0) { buyStack.shift(); pairs++; }
                        }
                      }
                      return <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{trades.length}{t('strategy.trades')} / {pairs}{t('strategy.pairs')}</p>;
                    })()}
                  </div>
                  {!isMobile && (
                    <div>
                      <p className="text-sm text-slate-500 mb-0.5">{t('strategy.latestPriceUsdt')}</p>
                      <p className="text-sm font-semibold">{latestPrice > 0 ? latestPrice.toFixed(latestPrice < 1 ? 5 : 2) : '--'}</p>
                    </div>
                  )}
                </div>

                {/* === Order Stats Tabs === */}
                {(() => {
                  const orders = allGridOrders.filter(o => o.strategyId === s.id);
                  const placedCount = orders.filter(o => o.status === 'placed').length;
                  const filledCount = orders.filter(o => o.status === 'filled').length;
                  const activeTab = orderTab[s.id!] || null;
                  const toggleTab = (tab: 'pending' | 'placed' | 'filled') => {
                    setOrderTab(prev => ({ ...prev, [s.id!]: prev[s.id!] === tab ? null : tab }));
                  };
                  const filteredOrders = activeTab ? orders.filter(o => o.status === activeTab) : [];
                  const buyOrders = filteredOrders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price);
                  const sellOrders = filteredOrders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price);
                  const priceFmt = (p: number) => p.toFixed(p < 1 ? 5 : 2);
                  const qtyFmt = (q: number) => q.toFixed(q < 1 ? 5 : 2);

                  return (
                    <>
                      {/* Tab buttons */}
                      <div className={`flex items-center gap-0 ${isMobile ? 'mx-3 mb-2' : 'mx-5 mb-3'} rounded-lg overflow-hidden border border-slate-700`}>
                        <button
                          onClick={() => toggleTab('placed')}
                          className={`flex-1 ${isMobile ? 'py-1.5' : 'py-2.5'} text-center transition-colors ${
                            activeTab === 'placed'
                              ? 'bg-amber-500/15 border-b-2 border-amber-400'
                              : 'bg-slate-800/60 hover:bg-slate-700/50'
                          }`}
                        >
                          <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold ${activeTab === 'placed' ? 'text-amber-400' : 'text-slate-300'}`}>{placedCount}</p>
                          <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium ${activeTab === 'placed' ? 'text-amber-400' : 'text-slate-500'}`}>{t('strategy.pendingOrders')}</p>
                        </button>
                        <div className="w-px bg-slate-700 self-stretch" />
                        <button
                          onClick={() => toggleTab('filled')}
                          className={`flex-1 ${isMobile ? 'py-1.5' : 'py-2.5'} text-center transition-colors ${
                            activeTab === 'filled'
                              ? 'bg-emerald-500/15 border-b-2 border-emerald-400'
                              : 'bg-slate-800/60 hover:bg-slate-700/50'
                          }`}
                        >
                          <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold ${activeTab === 'filled' ? 'text-emerald-400' : 'text-slate-300'}`}>{filledCount}</p>
                          <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium ${activeTab === 'filled' ? 'text-emerald-400' : 'text-slate-500'}`}>{t('strategy.filledOrders')}</p>
                        </button>
                      </div>

                      {/* Order detail — 待挂 & 挂单: two columns (buy / sell) */}
                      {activeTab && (activeTab === 'pending' || activeTab === 'placed') && filteredOrders.length > 0 && (
                        <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} grid grid-cols-2 ${isMobile ? 'gap-2' : 'gap-3'}`}>
                          {/* Buy orders column */}
                          <div className="rounded-lg border border-emerald-900/40 overflow-hidden">
                            <div className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-emerald-900/20 font-medium text-emerald-400 flex justify-between`}>
                              <span>{t('strategy.buyOrders')} ({buyOrders.length})</span>
                              <span>{t('strategy.priceQty')}</span>
                            </div>
                            <div className={`${isMobile ? 'max-h-40' : 'max-h-52'} overflow-y-auto divide-y divide-slate-800/50`}>
                              {buyOrders.length > 0 ? buyOrders.map((o, i) => (
                                <div key={o.id ?? i} className={`flex items-center justify-between ${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} hover:bg-emerald-900/5`}>
                                  <span className={`font-medium ${
                                    o.layer === 'trend' ? 'text-blue-400' : o.layer === 'swing' ? 'text-teal-400' : 'text-orange-400'
                                  }`}>
                                    {t(`strategy.layer.${o.layer}`)}
                                  </span>
                                  <span className="text-emerald-400 font-mono">{priceFmt(o.price)}</span>
                                  <span className="text-slate-400 font-mono">{qtyFmt(o.quantity)}</span>
                                </div>
                              )) : (
                                <div className={`py-3 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>{t('strategy.noBuyOrders')}</div>
                              )}
                            </div>
                          </div>
                          {/* Sell orders column */}
                          <div className="rounded-lg border border-red-900/40 overflow-hidden">
                            <div className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-red-900/20 font-medium text-red-400 flex justify-between`}>
                              <span>{t('strategy.sellOrders')} ({sellOrders.length})</span>
                              <span>{t('strategy.priceQty')}</span>
                            </div>
                            <div className={`${isMobile ? 'max-h-40' : 'max-h-52'} overflow-y-auto divide-y divide-slate-800/50`}>
                              {sellOrders.length > 0 ? sellOrders.map((o, i) => (
                                <div key={o.id ?? i} className={`flex items-center justify-between ${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} hover:bg-red-900/5`}>
                                  <span className={`font-medium ${
                                    o.layer === 'trend' ? 'text-blue-400' : o.layer === 'swing' ? 'text-teal-400' : 'text-orange-400'
                                  }`}>
                                    {t(`strategy.layer.${o.layer}`)}
                                  </span>
                                  <span className="text-red-400 font-mono">{priceFmt(o.price)}</span>
                                  <span className="text-slate-400 font-mono">{qtyFmt(o.quantity)}</span>
                                </div>
                              )) : (
                                <div className={`py-3 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>{t('strategy.noSellOrders')}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Order detail — 成交记录（逐笔，类似币安） */}
                      {activeTab === 'filled' && (() => {
                        const trades = allTradeRecords.filter(t => t.strategyId === s.id).sort((a, b) => b.timestamp - a.timestamp);
                        const filledGrids = orders.filter(o => o.status === 'filled');

                        // 直接从 tradeRecord.profit 读取（已由 updateStrategyProfit 回写到卖单上）
                        const profitMap = new Map<string, number>();
                        let pairsCount = 0;
                        let totalProfit = 0;
                        for (const t of trades) {
                          if (t.profit !== 0) {
                            profitMap.set(t.binanceTradeId, t.profit);
                            totalProfit += t.profit;
                            pairsCount++;
                          }
                        }

                        // 为每笔成交找挂单价（gridOrder.price）
                        const orderPriceMap = new Map<string, number>(); // binanceTradeId → 挂单价格
                        for (const t of trades) {
                          const go = filledGrids.find(o =>
                            o.binanceOrderId === t.binanceTradeId ||
                            (o.layer === t.layer && o.gridIndex === t.gridIndex && o.side === t.side)
                          );
                          if (go) orderPriceMap.set(t.binanceTradeId, go.price);
                        }

                        const dateFmt = (ts: number) => {
                          const d = new Date(ts);
                          return `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
                        };

                        if (trades.length === 0) return null;

                        return (
                          <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} rounded-lg border border-slate-700 overflow-hidden`}>
                            {/* 汇总栏 */}
                            <div className={`flex items-center justify-between ${isMobile ? 'px-2 py-2' : 'px-3 py-2.5'} bg-slate-800/80 border-b border-slate-700`}>
                              <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400`}>
                                {t('strategy.tradesSummary', { trades: trades.length, pairs: pairsCount })}
                              </span>
                              <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold font-mono ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isMobile ? '' : t('strategy.totalProfit') + ': '}{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(4)}
                              </span>
                            </div>
                            {/* 表格 - 横向滚动 */}
                            <div className="overflow-x-auto">
                              <table className={`w-full min-w-[700px] ${isMobile ? 'text-xs' : 'text-sm'}`}>
                                <thead>
                                  <tr className="bg-slate-800/50 text-slate-500 text-left">
                                    <th className="px-3 py-2 font-medium">{t('strategy.table.date')}</th>
                                    <th className="px-3 py-2 font-medium">{t('strategy.table.orderId')}</th>
                                    <th className="px-3 py-2 font-medium">{t('strategy.table.grid')}</th>
                                    <th className="px-3 py-2 font-medium">{t('strategy.table.direction')}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t('strategy.table.orderPrice')}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t('strategy.table.fillPrice')}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t('strategy.table.quantity')}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t('strategy.table.amount')}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t('strategy.table.fee')}</th>
                                    <th className="px-3 py-2 font-medium text-right">{t('strategy.table.profit')}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                  {trades.map((t, idx) => {
                                    const orderPrice = orderPriceMap.get(t.binanceTradeId);
                                    const pairProfit = profitMap.get(t.binanceTradeId);
                                    const layerLabel = t.layer === 'trend' ? 'Trend' : t.layer === 'swing' ? 'Swing' : 'Spike';
                                    const layerColor = t.layer === 'trend' ? 'text-blue-400' : t.layer === 'swing' ? 'text-emerald-400' : 'text-orange-400';

                                    return (
                                      <tr key={t.id ?? idx} className="hover:bg-slate-800/30">
                                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{dateFmt(t.timestamp)}</td>
                                        <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">#{t.binanceTradeId || '--'}</td>
                                        <td className={`px-3 py-2 font-medium whitespace-nowrap ${layerColor}`}>{layerLabel}#{t.gridIndex}</td>
                                        <td className="px-3 py-2">
                                          <span className={`px-2 py-0.5 rounded font-medium ${
                                            t.side === 'buy'
                                              ? 'bg-emerald-500/15 text-emerald-400'
                                              : 'bg-red-500/15 text-red-400'
                                          }`}>
                                            {t.side === 'buy' ? 'Buy' : 'Sell'}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-400">{orderPrice ? priceFmt(orderPrice) : '--'}</td>
                                        <td className={`px-3 py-2 text-right font-mono ${t.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>{priceFmt(t.price)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-300">{qtyFmt(t.quantity)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-300">{t.quoteAmount.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-500 whitespace-nowrap">{t.fee > 0 ? `${t.fee.toFixed(6)} ${t.feeAsset}` : '--'}</td>
                                        <td className={`px-3 py-2 text-right font-mono font-bold whitespace-nowrap ${
                                          pairProfit === undefined ? 'text-slate-600' :
                                          pairProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                                        }`}>
                                          {pairProfit !== undefined
                                            ? `${pairProfit >= 0 ? '+' : ''}${pairProfit.toFixed(4)}`
                                            : t.side === 'buy' ? 'Pending' : '--'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {activeTab === 'filled' && allTradeRecords.filter(t => t.strategyId === s.id).length === 0 && (
                        <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} py-4 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>{t('strategy.noTradeRecords')}</div>
                      )}
                      {activeTab && activeTab === 'placed' && filteredOrders.length === 0 && (
                        <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} py-4 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>
                          {t('strategy.noPendingOrders')}
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* === Row 6: Action Buttons === */}
                <div className={`flex items-center ${isMobile ? 'gap-2 px-3 pb-3' : 'gap-3 px-5 pb-4'}`}>
                  {operatingIds.has(s.id!) ? (
                    <div className="flex-1 flex justify-center py-2">
                      <Loader2 className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-blue-400 animate-spin`} />
                    </div>
                  ) : (
                    <>
                      {(s.status === 'running' || s.status === 'paused') && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-slate-800 hover:bg-slate-700 font-medium text-slate-200 transition-colors`}
                          onClick={() => handleStop(s)}
                        >
                          {t('common.stop')}
                        </button>
                      )}
                      {(s.status === 'idle' || s.status === 'stopped') && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-white transition-colors`}
                          onClick={() => handleStart(s)}
                        >
                          {t('common.start')}
                        </button>
                      )}
                      {s.status === 'running' && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-yellow-600/20 hover:bg-yellow-600/30 font-medium text-yellow-400 transition-colors border border-yellow-600/30`}
                          onClick={() => handlePause(s)}
                        >
                          {t('common.pause')}
                        </button>
                      )}
                      {s.status === 'paused' && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-white transition-colors`}
                          onClick={() => handleStart(s)}
                        >
                          {t('common.resume')}
                        </button>
                      )}
                      <button
                        className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors`}
                        onClick={() => setEditingStrategy(s)}
                        title={t('strategy.editStrategy')}
                      >
                        <Edit3 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                      </button>
                      <button
                        className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors`}
                        onClick={() => setExpandedId(isExpanded ? null : s.id!)}
                        title={t('common.details')}
                      >
                        {isExpanded ? <ChevronUp className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} /> : <ChevronDown className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />}
                      </button>
                      {/* Share / Unshare button */}
                      {shareCodes[s.id!] ? (
                        <button
                          className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-cyan-900/20 hover:bg-cyan-900/30 text-cyan-400 transition-colors`}
                          onClick={() => handleUnshare(s.id!)}
                          title={t('strategy.cancelShare')}
                        >
                          <Share2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        </button>
                      ) : (
                        <button
                          className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors`}
                          onClick={() => setShareModalStrategy(s)}
                          title={t('strategy.shareToPlaza')}
                        >
                          <Share2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        </button>
                      )}
                      {s.status !== 'running' && (
                        <button
                          className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-red-900/20 hover:bg-red-900/30 text-red-400 transition-colors`}
                          onClick={() => handleDelete(s.id!)}
                          title={t('common.delete')}
                        >
                          <Trash2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Error */}
                {errors[s.id!] && (
                  <div className={`${isMobile ? 'mx-3 mb-3 text-xs' : 'mx-5 mb-4 text-sm'} flex items-center gap-2 text-red-400 bg-red-900/10 rounded-lg px-3 py-2`}>
                    <AlertCircle className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0`} />
                    <span>{errors[s.id!]}</span>
                    <button className={`ml-auto ${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 hover:text-slate-300`} onClick={() => setErrors(prev => { const n = { ...prev }; delete n[s.id!]; return n; })}>×</button>
                  </div>
                )}

                {/* Logs */}
                {isExpanded && logs[s.id!] && logs[s.id!].length > 0 && (
                  <div className={`${isMobile ? 'mx-3 mb-3 p-2' : 'mx-5 mb-4 p-3'} rounded-lg bg-slate-950 border border-slate-800 max-h-32 overflow-y-auto`}>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 mb-1`}>{t('strategy.executionLog')}</p>
                    {logs[s.id!].map((l, i) => (
                      <p key={i} className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-mono`}>{l}</p>
                    ))}
                  </div>
                )}

                {/* Detail Panel */}
                {isExpanded && (
                  <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} pt-4 border-t border-slate-800`}>
                    <StrategyDetail strategy={s} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </div>

        {/* Right: Strategy Plaza */}
        <div className={isMobile ? 'w-full' : 'flex-1 min-w-0 overflow-y-auto'}>
          <StrategyPlaza onCopyStrategy={handleCopyFromPlaza} />
        </div>
      </div>
      {/* 终止策略确认弹窗 */}
      {stopConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setStopConfirm(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className={`relative ${isMobile ? 'mx-4 p-5' : 'p-6'} rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl max-w-md w-full`}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-3">{t('strategy.stopConfirmTitle')}</h3>
            <p className="text-sm text-slate-300 mb-2">
              {t('strategy.stopConfirmName')}: <span className="text-white font-medium">{stopConfirm.strategy.name}</span>
            </p>
            <p className="text-sm text-slate-300 mb-1">
              {t('strategy.stopConfirmSymbol')}: <span className="text-yellow-400 font-medium">{stopConfirm.strategy.symbol}</span>
            </p>
            <p className="text-sm text-slate-300 mb-1">
              {t('strategy.stopConfirmOrders')}: <span className="text-blue-400 font-bold">{stopConfirm.orderCount}</span> {t('strategy.stopConfirmOrdersUnit')}
            </p>
            {stopConfirm.orderCount > 0 && (
              <p className="text-sm text-amber-400/80 mb-4">
                ⏱ {t('strategy.stopConfirmEstimate', { seconds: Math.max(5, Math.ceil(stopConfirm.orderCount * 0.3)) })}
              </p>
            )}
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={handleStopConfirmCancel}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-sm transition-colors"
              >
                {t('strategy.stopConfirmCancelOrders')}
              </button>
              <button
                onClick={handleStopWithoutCancel}
                className="w-full py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-sm transition-colors"
              >
                {t('strategy.stopConfirmKeepOrders')}
              </button>
              <button
                onClick={() => setStopConfirm(null)}
                className="w-full py-2 rounded-lg text-slate-500 hover:text-slate-300 text-sm transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
