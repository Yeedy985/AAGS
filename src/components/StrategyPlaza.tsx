/**
 * StrategyPlaza — 策略广场组件
 * 展示公共策略列表 (币安策略广场风格卡片)
 * 支持筛选、排序、复制
 */
import { useState, useEffect, useCallback } from 'react';
import { Users, RefreshCw, ChevronDown, Loader2, TrendingUp, Clock, Wallet, BarChart3, AlertTriangle } from 'lucide-react';
import { fetchPlazaStrategies, fetchPlazaStrategyDetail, recordCopy } from '../services/strategyPlazaService';
import type { PlazaStrategyItem } from '../services/strategyPlazaService';
import type { Strategy } from '../types';
import { db } from '../db';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  onCopyStrategy?: (strategy: Strategy) => void;
}

function formatRuntime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}时 ${mins}分`;
  if (hours > 0) return `${hours}时 ${mins}分`;
  return `${mins}分`;
}

// 迷你收益曲线 SVG
function MiniChart({ points, positive }: { points: number[]; positive: boolean }) {
  if (!points || points.length < 2) return null;
  const width = 80;
  const height = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);

  const pathData = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <path d={pathData} fill="none" stroke={positive ? '#10b981' : '#ef4444'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type SortOption = 'pnl' | 'copies' | 'newest' | 'runtime';

export default function StrategyPlaza({ onCopyStrategy }: Props) {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<PlazaStrategyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // 筛选
  const [sort, setSort] = useState<SortOption>('pnl');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // 复制中状态
  const [copyingCode, setCopyingCode] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const sortLabels: Record<SortOption, string> = {
    pnl: '收益率最高',
    copies: '复制最多',
    newest: '最新分享',
    runtime: '运行最久',
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchPlazaStrategies({
        page,
        pageSize: 20,
        sort,
        symbol: symbolFilter || undefined,
      });
      setItems(res.items);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || '加载失败');
    }
    setLoading(false);
  }, [page, sort, symbolFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  // 复制策略到本地
  const handleCopy = async (item: PlazaStrategyItem) => {
    setCopyingCode(item.shareCode);
    try {
      const detail = await fetchPlazaStrategyDetail(item.shareCode);
      await recordCopy(item.shareCode);

      // 从 gridConfig 构建本地 Strategy
      const config = detail.gridConfig || {};
      const strategy: Strategy = {
        name: `[复制] ${detail.strategyName}`,
        symbol: detail.symbol,
        baseAsset: detail.baseAsset,
        quoteAsset: detail.quoteAsset || 'USDT',
        status: 'idle',
        totalFund: config.totalFund || Number(detail.minInvestUsdt) || 1000,
        usedFund: 0,
        rangeMode: config.rangeMode || 'fixed',
        upperPrice: config.upperPrice || 0,
        lowerPrice: config.lowerPrice || 0,
        centerPrice: config.centerPrice || 0,
        atrPeriod: config.atrPeriod || 14,
        atrMultiplier: config.atrMultiplier || 2,
        layers: config.layers || [],
        profitAllocation: config.profitAllocation || 'ratio',
        profitRatio: config.profitRatio || 50,
        profitThreshold: config.profitThreshold || 10,
        trendSellAbovePercent: config.trendSellAbovePercent || 10,
        trendBuyBelowPercent: config.trendBuyBelowPercent || 10,
        risk: config.risk || {
          circuitBreakEnabled: true, circuitBreakDropPercent: 5, circuitBreakVolumeMultiple: 5,
          dailyDrawdownEnabled: true, dailyDrawdownPercent: 5,
          maxPositionEnabled: true, maxPositionPercent: 80,
          trendDefenseEnabled: true, trendDefenseEmaFast: 12, trendDefenseEmaSlow: 26,
        },
        autoRebalance: config.autoRebalance ?? true,
        rebalanceStepPercent: config.rebalanceStepPercent || 5,
        endMode: config.endMode || 'keep_position',
        totalProfit: 0,
        todayProfit: 0,
        totalTrades: 0,
        winTrades: 0,
        maxDrawdown: 0,
        createdAt: Date.now(),
      };

      // 保存到本地 DB
      const id = await db.strategies.add(strategy);
      strategy.id = id;
      if (onCopyStrategy) onCopyStrategy(strategy);

      setCopySuccess(item.shareCode);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err: any) {
      alert('复制失败: ' + (err.message || '未知错误'));
    }
    setCopyingCode(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className={`flex items-center justify-between ${isMobile ? 'mb-2' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-slate-200`}>策略广场</h2>
          {total > 0 && <span className="text-xs text-slate-500">共 {total} 个策略</span>}
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="刷新"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className={`flex items-center gap-2 ${isMobile ? 'mb-2' : 'mb-3'} flex-wrap`}>
        {/* Symbol filter */}
        <input
          type="text"
          placeholder="搜索交易对..."
          value={symbolFilter}
          onChange={(e) => { setSymbolFilter(e.target.value.toUpperCase()); setPage(1); }}
          className={`${isMobile ? 'w-28 text-xs px-2 py-1.5' : 'w-36 text-sm px-3 py-2'} rounded-lg bg-slate-800/60 border border-slate-700 text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none`}
        />

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className={`flex items-center gap-1.5 ${isMobile ? 'text-xs px-2 py-1.5' : 'text-sm px-3 py-2'} rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:border-slate-600`}
          >
            {sortLabels[sort]}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showSortDropdown && (
            <div className="absolute top-full mt-1 left-0 z-20 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[130px]">
              {(Object.keys(sortLabels) as SortOption[]).map((key) => (
                <button
                  key={key}
                  onClick={() => { setSort(key); setShowSortDropdown(false); setPage(1); }}
                  className={`block w-full text-left ${isMobile ? 'text-xs px-3 py-2' : 'text-sm px-4 py-2.5'} hover:bg-slate-700 transition-colors ${sort === key ? 'text-cyan-400' : 'text-slate-300'}`}
                >
                  {sortLabels[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-10">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <p className="text-sm text-slate-400">{error}</p>
            <button onClick={loadData} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">重试</button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <BarChart3 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">暂无策略</p>
            <p className="text-xs text-slate-600 mt-1">成为第一个分享策略的人吧</p>
          </div>
        ) : (
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-2' : 'grid-cols-1 gap-3'}`}>
            {items.map((item) => (
              <StrategyCard
                key={item.shareCode}
                item={item}
                isMobile={isMobile}
                onCopy={() => handleCopy(item)}
                copying={copyingCode === item.shareCode}
                copied={copySuccess === item.shareCode}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={`flex items-center justify-center gap-2 ${isMobile ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-slate-800`}>
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
          >
            上一页
          </button>
          <span className="text-xs text-slate-500">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

// ── 策略卡片 (币安风格) ──
function StrategyCard({ item, isMobile, onCopy, copying, copied }: {
  item: PlazaStrategyItem;
  isMobile: boolean;
  onCopy: () => void;
  copying: boolean;
  copied: boolean;
}) {
  const positive = item.pnlPercent >= 0;
  const isOnline = item.lastSyncAt && (Date.now() - new Date(item.lastSyncAt).getTime() < 3600_000);

  return (
    <div
      className={`${isMobile ? 'rounded-xl p-3' : 'rounded-xl p-4'} border transition-all hover:border-slate-600`}
      style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(10,15,30,0.9) 100%)',
        borderColor: 'rgba(51,65,85,0.4)',
      }}
    >
      {/* Row 1: Symbol + Copy button */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`${isMobile ? 'text-sm' : 'text-base'} font-bold text-white`}>
              {item.baseAsset}/{item.quoteAsset}
            </span>
            <span className="text-xs text-slate-500">
              共{item.totalGrids}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{item.strategyName}</p>
        </div>
        <button
          onClick={onCopy}
          disabled={copying}
          className={`${isMobile ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-xs'} rounded-lg font-bold transition-all ${
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-amber-500 hover:bg-amber-400 text-slate-900'
          }`}
        >
          {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* Row 2: PnL + Mini chart */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className={`${isMobile ? 'text-xs' : 'text-xs'} text-slate-500 mb-0.5`}>盈亏 (USDT)</p>
          <p className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {positive ? '+' : ''}{item.pnlUsdt.toFixed(2)}
          </p>
        </div>
        <MiniChart points={item.chartPoints || []} positive={positive} />
      </div>

      {/* Row 3: Stats grid */}
      <div className={`grid grid-cols-3 gap-3 ${isMobile ? 'text-xs' : 'text-xs'}`}>
        <div>
          <p className="text-slate-500 mb-0.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> 收益率
          </p>
          <p className={`font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {positive ? '+' : ''}{item.pnlPercent.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3" /> 运行时间
          </p>
          <p className="font-semibold text-slate-200">{formatRuntime(item.runSeconds)}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5 flex items-center gap-1">
            <Wallet className="w-3 h-3" /> 最小投资
          </p>
          <p className="font-semibold text-slate-200">{item.minInvestUsdt.toFixed(2)} USDT</p>
        </div>
      </div>

      {/* Row 4: Match count / Drawdown / Users */}
      <div className={`grid grid-cols-3 gap-3 mt-2 pt-2 border-t border-slate-800/60 ${isMobile ? 'text-xs' : 'text-xs'}`}>
        <div>
          <p className="text-slate-500 mb-0.5">配对次数</p>
          <p className="font-semibold text-slate-300">{item.matchCount}/{item.totalGrids}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">7天最大回撤</p>
          <p className="font-semibold text-slate-300">{item.maxDrawdownPct.toFixed(2)}%</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-500 mb-0.5 flex items-center gap-1">
              <Users className="w-3 h-3" /> 使用人数
            </p>
            <p className="font-semibold text-slate-300">{item.copyCount}人</p>
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${item.isRunning && isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <span className={`text-xs ${item.isRunning && isOnline ? 'text-emerald-400' : 'text-slate-600'}`}>
              {item.isRunning && isOnline ? '运行中' : '离线'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
