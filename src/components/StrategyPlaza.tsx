/**
 * StrategyPlaza — 策略广场组件
 * 展示公共策略列表 (币安策略广场风格卡片)
 * 支持筛选、排序、复制
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, Loader2, BarChart3, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchPlazaStrategies, fetchPlazaStrategyDetail, recordCopy } from '../services/strategyPlazaService';
import type { PlazaStrategyItem } from '../services/strategyPlazaService';
import type { Strategy } from '../types';
import { db } from '../db';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  onCopyStrategy?: (strategy: Strategy) => void;
}

function formatRuntime(seconds: number, t: (key: string) => string): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const d = t('strategy.runtimeFormat.days');
  const h = t('strategy.runtimeFormat.hours');
  const m = t('strategy.runtimeFormat.minutes');
  if (days > 0) return `${days}${d} ${hours}${h} ${mins}${m}`;
  if (hours > 0) return `${hours}${h} ${mins}${m}`;
  return `${mins}${m}`;
}

// 收益曲线 SVG (币安风格，较大)
function PnlChart({ points, positive, width = 120, height = 40 }: { points: number[]; positive: boolean; width?: number; height?: number }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const color = positive ? '#0ecb81' : '#f6465d';

  const pathData = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p - min) / range) * (height - 6) - 3;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // 渐变填充区域
  const lastX = (points.length - 1) * step;
  const areaData = `${pathData} L${lastX.toFixed(1)},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <defs>
        <linearGradient id={`grad-${positive ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaData} fill={`url(#grad-${positive ? 'up' : 'down'})`} />
      <path d={pathData} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type SortOption = 'pnl' | 'copies' | 'newest' | 'runtime';

export default function StrategyPlaza({ onCopyStrategy }: Props) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
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
    pnl: t('plaza.sortOptions.pnl'),
    copies: t('plaza.sortOptions.copies'),
    newest: t('plaza.sortOptions.newest'),
    runtime: t('plaza.sortOptions.runtime'),
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
      setError(err.message || t('plaza.loadFailed'));
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
        name: `${t('plaza.copyPrefix')} ${detail.strategyName}`,
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
      alert(t('plaza.copyFailed') + ': ' + (err.message || ''));
    }
    setCopyingCode(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className={`flex items-center justify-between ${isMobile ? 'mb-2' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-slate-200`}>{t('plaza.title')}</h2>
          {total > 0 && <span className="text-xs text-slate-500">{t('plaza.totalStrategies', { count: total })}</span>}
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title={t('common.refresh')}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className={`flex items-center gap-2 ${isMobile ? 'mb-2' : 'mb-3'} flex-wrap`}>
        {/* Symbol filter */}
        <input
          type="text"
          placeholder={t('plaza.searchPair')}
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
            <button onClick={loadData} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">{t('common.retry')}</button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <BarChart3 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">{t('plaza.noStrategies')}</p>
            <p className="text-xs text-slate-600 mt-1">{t('plaza.beFirst')}</p>
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
            {t('plaza.prevPage')}
          </button>
          <span className="text-xs text-slate-500">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
          >
            {t('plaza.nextPage')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 策略卡片 (完全对标币安网格策略广场) ──
function StrategyCard({ item, isMobile, onCopy, copying, copied }: {
  item: PlazaStrategyItem;
  isMobile: boolean;
  onCopy: () => void;
  copying: boolean;
  copied: boolean;
}) {
  const { t } = useTranslation();
  const positive = item.pnlPercent >= 0;

  return (
    <div
      className={`${isMobile ? 'rounded-xl p-3.5' : 'rounded-2xl p-5'} border transition-all hover:border-slate-600`}
      style={{
        background: '#181A20',
        borderColor: 'rgba(43,47,54,0.8)',
      }}
    >
      {/* Row 1: Symbol + Grids badge + online dot ── 右侧: 复制按钮 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`${isMobile ? 'text-sm' : 'text-[15px]'} font-bold text-white tracking-tight`}>
            {item.baseAsset}/{item.quoteAsset}
          </span>
          <span className="text-[11px] text-slate-500 bg-[#2B2F36] px-1.5 py-0.5 rounded font-medium">
            {t('plaza.totalGrids', { count: item.totalGrids })}
          </span>
          <span className="relative flex h-2 w-2">
            {item.isRunning && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${item.isRunning ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </span>
        </div>
        <button
          onClick={onCopy}
          disabled={copying}
          className={`${isMobile ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-xs'} rounded font-bold transition-all ${
            copied
              ? 'bg-emerald-500 text-white'
              : 'bg-[#F0B90B] hover:bg-[#F8D12F] text-[#181A20]'
          }`}
        >
          {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : copied ? '✓' : t('common.copy')}
        </button>
      </div>

      {/* Row 2: 盈亏标签 + 收益曲线 (右侧) */}
      <div className="flex items-end justify-between mb-0.5">
        <div>
          <p className="text-[11px] text-slate-500 mb-1">{t('plaza.pnlUsdt')}</p>
          <p className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold tabular-nums tracking-tight leading-none ${positive ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
            {positive ? '+' : ''}{item.pnlUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <PnlChart points={item.chartPoints || []} positive={positive} width={isMobile ? 90 : 120} height={isMobile ? 32 : 40} />
      </div>

      {/* Row 3: 收益率 / 运行时间 / 最小投资额 (3列) */}
      <div className={`grid grid-cols-3 gap-x-3 mt-3 ${isMobile ? '' : ''}`}>
        <div>
          <p className="text-[11px] text-slate-500 mb-0.5">{t('plaza.returnRate')}</p>
          <p className={`text-[13px] font-bold ${positive ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
            {positive ? '+' : ''}{item.pnlPercent.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-0.5">{t('plaza.runtimeLabel')}</p>
          <p className="text-[13px] font-semibold text-slate-200">{formatRuntime(item.runSeconds, t)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-0.5">{t('plaza.minInvest')}</p>
          <p className="text-[13px] font-semibold text-slate-200">{item.minInvestUsdt.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDT</p>
        </div>
      </div>

      {/* Row 4: 24h/总匹配次数 / 7天最大回撤 (2列) */}
      <div className={`grid grid-cols-2 gap-x-3 mt-2.5 pt-2.5 border-t border-[#2B2F36]`}>
        <div>
          <p className="text-[11px] text-slate-500 mb-0.5">{t('plaza.matchCount')}</p>
          <p className="text-[13px] font-semibold text-slate-300">{item.matchCount}/{item.totalGrids}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-0.5">{t('plaza.maxDrawdown7d')}</p>
          <p className="text-[13px] font-semibold text-slate-300">{item.maxDrawdownPct.toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
}
