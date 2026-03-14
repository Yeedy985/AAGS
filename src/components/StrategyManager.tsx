import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Loader2, AlertCircle, Share2, X as XIcon } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store/useStore';
import { db } from '../db';
import type { Strategy } from '../types';
import StrategyCreator from './StrategyCreator';
import StrategyDetail from './StrategyDetail';
import StrategyPlaza from './StrategyPlaza';
import { startStrategy, stopStrategy, pauseStrategy, resumeStrategy, setExecutorCallbacks, updateStrategyProfit, repairMissingTradeRecords } from '../services/strategyExecutor';
import { shareStrategy, unshareStrategy } from '../services/strategyPlazaService';
import { useIsMobile } from '../hooks/useIsMobile';

function formatRuntime(startedAt?: number): string {
  if (!startedAt) return '--';
  const diff = Date.now() - startedAt;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}天 ${hours}时 ${mins}分`;
  if (hours > 0) return `${hours}时 ${mins}分`;
  return `${mins}分`;
}

export default function StrategyManager() {
  const { strategies, setStrategies, updateStrategy, removeStrategy, apiConfig, symbols, tickers } = useStore();
  const isMobile = useIsMobile();
  const [showCreator, setShowCreator] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [operatingIds, setOperatingIds] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<Record<number, string[]>>({});
  const [orderTab, setOrderTab] = useState<Record<number, 'placed' | 'filled' | 'pending' | null>>({});

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
      setErrors(prev => ({ ...prev, [strategy.id!]: '请先在「账户管理」中配置交易所 API Key' }));
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

  const handleStop = async (strategy: Strategy) => {
    if (!apiConfig) return;
    setOperatingIds(prev => new Set(prev).add(strategy.id!));
    try {
      await stopStrategy(strategy.id!, apiConfig);
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

  // ── 分享相关 ──
  const [shareModalStrategy, setShareModalStrategy] = useState<Strategy | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
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
      const totalGridCount = strategy.layers.filter(l => l.enabled).reduce((a, l) => a + l.gridCount, 0);
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
    } catch (err: any) {
      setShareError(err.message || '分享失败');
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
      alert('取消分享失败: ' + err.message);
    }
  };

  // 从策略广场复制策略后，刷新本地列表
  const handleCopyFromPlaza = (strategy: Strategy) => {
    setStrategies([...strategies, strategy]);
  };

  const statusLabels: Record<string, { text: string; class: string }> = {
    idle: { text: '待启动', class: 'badge-blue' },
    running: { text: '运行中', class: 'badge-green' },
    paused: { text: '已暂停', class: 'badge-yellow' },
    stopped: { text: '已停止', class: 'bg-slate-800 text-slate-400 text-sm px-2 py-0.5 rounded-full' },
    error: { text: '错误', class: 'badge-red' },
    circuit_break: { text: '熔断中', class: 'bg-orange-900/50 text-orange-400 text-sm px-2 py-0.5 rounded-full' },
  };

  return (
    <div className={isMobile ? 'space-y-3' : 'space-y-4'}>
      <div className="flex items-center justify-between">
        <h1 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>策略管理</h1>
        <button className={`btn-primary flex items-center gap-1.5 ${isMobile ? 'text-xs px-3 py-2' : ''}`} onClick={() => setShowCreator(true)}>
          <Plus className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          新建策略
        </button>
      </div>

      {/* Strategy Creator Modal */}
      {showCreator && (
        <StrategyCreator onCreated={handleCreated} onCancel={() => setShowCreator(false)} />
      )}

      {/* Share Confirmation Modal */}
      {shareModalStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">分享策略到策略广场</h3>
              <button onClick={() => setShareModalStrategy(null)} className="text-slate-400 hover:text-white"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-300 font-medium mb-1">隐私说明</p>
              <p className="text-xs text-amber-200/70 leading-relaxed">
                仅上传策略参数和运行收益数据，<strong className="text-amber-200">不会上传任何 API Key、账户信息或个人隐私数据</strong>。
                其他用户可以看到：交易对、网格配置、收益率、运行时长等。你可以随时取消分享。
              </p>
            </div>
            <div className="mb-4 p-3 rounded-lg bg-slate-800 text-sm">
              <p className="text-slate-400">策略: <span className="text-white font-medium">{shareModalStrategy.name}</span></p>
              <p className="text-slate-400 mt-1">交易对: <span className="text-white">{shareModalStrategy.symbol}</span></p>
              <p className="text-slate-400 mt-1">投资额: <span className="text-white">{shareModalStrategy.totalFund} USDT</span></p>
            </div>
            {shareError && <p className="text-sm text-red-400 mb-3">{shareError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setShareModalStrategy(null)}
                className="flex-1 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-300"
              >
                取消
              </button>
              <button
                onClick={() => handleShare(shareModalStrategy)}
                disabled={sharing}
                className="flex-1 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-bold text-white flex items-center justify-center gap-2"
              >
                {sharing && <Loader2 className="w-4 h-4 animate-spin" />}
                确认分享
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left-Right Split Layout */}
      <div className={`flex ${isMobile ? 'flex-col gap-4' : 'gap-6'}`} style={isMobile ? {} : { minHeight: 'calc(100vh - 180px)' }}>
        {/* Left: My Strategies */}
        <div className={isMobile ? 'w-full' : 'w-[45%] shrink-0 overflow-y-auto'}>
      {strategies.length === 0 ? (
        <div className={`card ${isMobile ? 'py-10' : 'py-16'} text-center`}>
          <p className={`text-slate-500 ${isMobile ? 'text-base' : 'text-lg'}`}>暂无策略</p>
          <p className={`text-slate-600 ${isMobile ? 'text-xs' : 'text-sm'} mt-2`}>点击"新建策略"开始创建您的第一个网格交易策略</p>
        </div>
      ) : (
        <div className={isMobile ? 'space-y-3' : 'space-y-4'}>
          {strategies.map((s) => {
            const status = statusLabels[s.status] || statusLabels.idle;
            const isExpanded = expandedId === s.id;
            const ticker = tickers.get(s.symbol);
            const latestPrice = ticker ? parseFloat(ticker.price) : 0;
            const totalGridCount = s.layers.filter(l => l.enabled).reduce((a, l) => a + l.gridCount, 0);
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
                  <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>现货网格</span>
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
                      ? (s.startedAt ? `运行 ${formatRuntime(s.startedAt)}` : '未启动')
                      : `创建时间 ${new Date(s.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}${s.startedAt ? `, 运行时间 ${formatRuntime(s.startedAt)}` : ''}`
                    }
                  </p>
                </div>

                {/* === Row 3: grid — Investment / Price Range / Grid Count === */}
                <div className={`grid ${isMobile ? 'grid-cols-2 gap-x-2 gap-y-1.5 px-3' : 'grid-cols-3 gap-4 px-5'} pb-2.5`}>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? '投资额' : '总投资额 (USDT)'}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{s.totalFund.toFixed(isMobile ? 2 : 5)}</p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? '价格范围' : '价格范围 (USDT)'}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{s.lowerPrice.toFixed(isMobile ? 2 : 5)} - {s.upperPrice.toFixed(isMobile ? 2 : 5)}</p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>网格数量</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{totalGridCount}</p>
                  </div>
                  {isMobile && (
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">最新价</p>
                      <p className="text-xs font-semibold">{latestPrice > 0 ? latestPrice.toFixed(latestPrice < 1 ? 5 : 2) : '--'}</p>
                    </div>
                  )}
                </div>

                {/* === Row 4: Total Profit / Grid Profit / Unrealized PnL === */}
                <div className={`grid grid-cols-3 ${isMobile ? 'gap-1 px-3' : 'gap-4 px-5'} pb-2.5`}>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? '总收益' : '总收益(USDT)'}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(isMobile ? 2 : 5)}
                    </p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalReturn >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? '网格利润' : '网格利润(USDT)'}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold ${gridProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gridProfit >= 0 ? '+' : ''}{gridProfit.toFixed(isMobile ? 2 : 5)}
                    </p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} ${gridProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gridProfit >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? '浮动盈亏' : '浮动盈亏(USDT)'}</p>
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
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>{isMobile ? '每笔数量' : `每笔数量 (${s.baseAsset})`}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{perGridQty > 0 ? perGridQty.toFixed(perGridQty < 1 ? 5 : 2) : '--'}</p>
                  </div>
                  <div>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-0.5`}>成交/配对</p>
                    {(() => {
                      const trades = allTradeRecords.filter(t => t.strategyId === s.id);
                      const tradeGroups = new Map<string, { buys: number; sells: number }>();
                      for (const t of trades) {
                        const k = `${t.layer}_${t.gridIndex}`;
                        const g = tradeGroups.get(k) || { buys: 0, sells: 0 };
                        if (t.side === 'buy') g.buys++; else g.sells++;
                        tradeGroups.set(k, g);
                      }
                      const pairs = Array.from(tradeGroups.values()).reduce((sum, g) => sum + Math.min(g.buys, g.sells), 0);
                      return <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>{trades.length}笔 / {pairs}对</p>;
                    })()}
                  </div>
                  {!isMobile && (
                    <div>
                      <p className="text-sm text-slate-500 mb-0.5">最新价 (USDT)</p>
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
                          <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium ${activeTab === 'placed' ? 'text-amber-400' : 'text-slate-500'}`}>挂单</p>
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
                          <p className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium ${activeTab === 'filled' ? 'text-emerald-400' : 'text-slate-500'}`}>成交</p>
                        </button>
                      </div>

                      {/* Order detail — 待挂 & 挂单: two columns (buy / sell) */}
                      {activeTab && (activeTab === 'pending' || activeTab === 'placed') && filteredOrders.length > 0 && (
                        <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} grid grid-cols-2 ${isMobile ? 'gap-2' : 'gap-3'}`}>
                          {/* Buy orders column */}
                          <div className="rounded-lg border border-emerald-900/40 overflow-hidden">
                            <div className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-emerald-900/20 font-medium text-emerald-400 flex justify-between`}>
                              <span>买单 ({buyOrders.length})</span>
                              <span>价格 / 数量</span>
                            </div>
                            <div className={`${isMobile ? 'max-h-40' : 'max-h-52'} overflow-y-auto divide-y divide-slate-800/50`}>
                              {buyOrders.length > 0 ? buyOrders.map((o, i) => (
                                <div key={o.id ?? i} className={`flex items-center justify-between ${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} hover:bg-emerald-900/5`}>
                                  <span className={`font-medium ${
                                    o.layer === 'trend' ? 'text-blue-400' : o.layer === 'swing' ? 'text-teal-400' : 'text-orange-400'
                                  }`}>
                                    {o.layer === 'trend' ? '趋势' : o.layer === 'swing' ? '震荡' : '插针'}
                                  </span>
                                  <span className="text-emerald-400 font-mono">{priceFmt(o.price)}</span>
                                  <span className="text-slate-400 font-mono">{qtyFmt(o.quantity)}</span>
                                </div>
                              )) : (
                                <div className={`py-3 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>无买单</div>
                              )}
                            </div>
                          </div>
                          {/* Sell orders column */}
                          <div className="rounded-lg border border-red-900/40 overflow-hidden">
                            <div className={`${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} bg-red-900/20 font-medium text-red-400 flex justify-between`}>
                              <span>卖单 ({sellOrders.length})</span>
                              <span>价格 / 数量</span>
                            </div>
                            <div className={`${isMobile ? 'max-h-40' : 'max-h-52'} overflow-y-auto divide-y divide-slate-800/50`}>
                              {sellOrders.length > 0 ? sellOrders.map((o, i) => (
                                <div key={o.id ?? i} className={`flex items-center justify-between ${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} hover:bg-red-900/5`}>
                                  <span className={`font-medium ${
                                    o.layer === 'trend' ? 'text-blue-400' : o.layer === 'swing' ? 'text-teal-400' : 'text-orange-400'
                                  }`}>
                                    {o.layer === 'trend' ? '趋势' : o.layer === 'swing' ? '震荡' : '插针'}
                                  </span>
                                  <span className="text-red-400 font-mono">{priceFmt(o.price)}</span>
                                  <span className="text-slate-400 font-mono">{qtyFmt(o.quantity)}</span>
                                </div>
                              )) : (
                                <div className={`py-3 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>无卖单</div>
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
                                {trades.length}笔成交 · {pairsCount}对配对
                              </span>
                              <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold font-mono ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isMobile ? '' : '总利润: '}{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(4)}
                              </span>
                            </div>
                            {/* 表格 - 横向滚动 */}
                            <div className="overflow-x-auto">
                              <table className={`w-full min-w-[700px] ${isMobile ? 'text-xs' : 'text-sm'}`}>
                                <thead>
                                  <tr className="bg-slate-800/50 text-slate-500 text-left">
                                    <th className="px-3 py-2 font-medium">日期</th>
                                    <th className="px-3 py-2 font-medium">订单号</th>
                                    <th className="px-3 py-2 font-medium">网格</th>
                                    <th className="px-3 py-2 font-medium">方向</th>
                                    <th className="px-3 py-2 font-medium text-right">挂单价</th>
                                    <th className="px-3 py-2 font-medium text-right">成交价</th>
                                    <th className="px-3 py-2 font-medium text-right">数量</th>
                                    <th className="px-3 py-2 font-medium text-right">成交金额</th>
                                    <th className="px-3 py-2 font-medium text-right">手续费</th>
                                    <th className="px-3 py-2 font-medium text-right">利润</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                  {trades.map((t, idx) => {
                                    const orderPrice = orderPriceMap.get(t.binanceTradeId);
                                    const pairProfit = profitMap.get(t.binanceTradeId);
                                    const layerLabel = t.layer === 'trend' ? '趋势' : t.layer === 'swing' ? '震荡' : '插针';
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
                                            {t.side === 'buy' ? '买入' : '卖出'}
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
                                            : t.side === 'buy' ? '待配对' : '--'}
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
                        <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} py-4 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>暂无成交记录</div>
                      )}
                      {activeTab && activeTab === 'placed' && filteredOrders.length === 0 && (
                        <div className={`${isMobile ? 'mx-3 mb-3' : 'mx-5 mb-4'} py-4 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>
                          暂无挂单订单
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
                          终止
                        </button>
                      )}
                      {(s.status === 'idle' || s.status === 'stopped') && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-white transition-colors`}
                          onClick={() => handleStart(s)}
                        >
                          启动
                        </button>
                      )}
                      {s.status === 'running' && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-yellow-600/20 hover:bg-yellow-600/30 font-medium text-yellow-400 transition-colors border border-yellow-600/30`}
                          onClick={() => handlePause(s)}
                        >
                          暂停
                        </button>
                      )}
                      {s.status === 'paused' && (
                        <button
                          className={`flex-1 ${isMobile ? 'py-2 text-xs' : 'py-2.5 text-sm'} rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-white transition-colors`}
                          onClick={() => handleStart(s)}
                        >
                          恢复
                        </button>
                      )}
                      <button
                        className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors`}
                        onClick={() => setExpandedId(isExpanded ? null : s.id!)}
                        title="详情"
                      >
                        {isExpanded ? <ChevronUp className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} /> : <ChevronDown className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />}
                      </button>
                      {/* Share / Unshare button */}
                      {shareCodes[s.id!] ? (
                        <button
                          className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-cyan-900/20 hover:bg-cyan-900/30 text-cyan-400 transition-colors`}
                          onClick={() => handleUnshare(s.id!)}
                          title="取消分享"
                        >
                          <Share2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        </button>
                      ) : (
                        <button
                          className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors`}
                          onClick={() => setShareModalStrategy(s)}
                          title="分享到策略广场"
                        >
                          <Share2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        </button>
                      )}
                      {s.status !== 'running' && (
                        <button
                          className={`${isMobile ? 'p-2' : 'p-2.5'} rounded-lg bg-red-900/20 hover:bg-red-900/30 text-red-400 transition-colors`}
                          onClick={() => handleDelete(s.id!)}
                          title="删除"
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
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 mb-1`}>执行日志</p>
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
    </div>
  );
}
