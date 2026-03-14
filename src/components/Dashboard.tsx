import { TrendingUp, TrendingDown, Wallet, Activity, Target, Zap } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, ReferenceLine, ComposedChart, Line } from 'recharts';
import { useMemo, useState, useRef, useEffect } from 'react';
import { updateStrategyProfit } from '../services/strategyExecutor';
import type { EquitySnapshot, TradeRecord } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

const STAT_STYLES: Record<string, { bg: string; shadow: string; text: string }> = {
  blue:   { bg: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)', shadow: '0 2px 10px -2px rgba(59,130,246,0.25)', text: 'text-blue-400' },
  green:  { bg: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.05) 100%)', shadow: '0 2px 10px -2px rgba(16,185,129,0.25)', text: 'text-emerald-400' },
  red:    { bg: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.05) 100%)', shadow: '0 2px 10px -2px rgba(239,68,68,0.25)', text: 'text-red-400' },
  yellow: { bg: 'linear-gradient(135deg, rgba(234,179,8,0.15) 0%, rgba(234,179,8,0.05) 100%)', shadow: '0 2px 10px -2px rgba(234,179,8,0.25)', text: 'text-yellow-400' },
  purple: { bg: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.05) 100%)', shadow: '0 2px 10px -2px rgba(139,92,246,0.25)', text: 'text-violet-400' },
};

function StatCard({ title, value, sub, icon: Icon, color, compact }: {
  title: string; value: string; sub?: string; icon: any; color: string; compact?: boolean;
}) {
  const s = STAT_STYLES[color] || STAT_STYLES.blue;
  if (compact) {
    return (
      <div className="rounded-xl border border-white/[0.04] px-3 py-2.5 flex items-center gap-2.5" style={{ background: s.bg, boxShadow: s.shadow }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.06] shrink-0">
          <Icon className={`w-3.5 h-3.5 ${s.text}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 font-medium truncate">{title}</p>
          <p className="text-sm font-bold tracking-tight truncate">{value}</p>
          {sub && <p className="text-[10px] text-slate-500 truncate">{sub}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/[0.04] p-4 flex items-start gap-3" style={{ background: s.bg, boxShadow: s.shadow }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.06] shrink-0">
        <Icon className={`w-[18px] h-[18px] ${s.text}`} />
      </div>
      <div>
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className="text-lg font-bold mt-0.5 tracking-tight">{value}</p>
        {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { strategies, accountInfo, tickers } = useStore();
  const isMobile = useIsMobile();

  const snapshots = useLiveQuery(
    () => db.equitySnapshots.where('strategyId').equals(0).sortBy('timestamp'),
    []
  );

  const allGridOrders = useLiveQuery(
    () => db.gridOrders.toArray(),
    [],
    []
  );

  const allTradeRecords = useLiveQuery(
    () => db.tradeRecords.toArray(),
    [],
    []
  );

  const stats = useMemo(() => {
    const running = strategies.filter((s) => s.status === 'running').length;
    const totalProfit = strategies.reduce((a, s) => a + s.totalProfit, 0);
    const todayProfit = strategies.reduce((a, s) => a + s.todayProfit, 0);
    const totalTrades = strategies.reduce((a, s) => a + s.totalTrades, 0);
    const winTrades = strategies.reduce((a, s) => a + s.winTrades, 0);
    const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(1) : '0.0';
    const maxDD = Math.max(...strategies.map((s) => s.maxDrawdown), 0);
    return { running, totalProfit, todayProfit, totalTrades, winRate, maxDD };
  }, [strategies]);

  // 时间粒度配置
  const INTERVALS = [
    { key: '1s',  label: '1秒',   ms: 1000,              maxPoints: 120 },
    { key: '1m',  label: '1分钟', ms: 60 * 1000,         maxPoints: 120 },
    { key: '15m', label: '15分钟', ms: 15 * 60 * 1000,   maxPoints: 96 },
    { key: '1h',  label: '1小时', ms: 60 * 60 * 1000,    maxPoints: 72 },
    { key: '4h',  label: '4小时', ms: 4 * 60 * 60 * 1000, maxPoints: 60 },
    { key: '1d',  label: '1日',   ms: 24 * 60 * 60 * 1000, maxPoints: 60 },
    { key: '1w',  label: '1周',   ms: 7 * 24 * 60 * 60 * 1000, maxPoints: 52 },
    { key: '1M',  label: '1月',   ms: 30 * 24 * 60 * 60 * 1000, maxPoints: 24 },
  ] as const;
  const [intervalKey, setIntervalKey] = useState<string>('1m');
  const selectedInterval = INTERVALS.find(i => i.key === intervalKey) || INTERVALS[1];

  const chartData = useMemo(() => {
    if (!snapshots?.length) return [];
    const { ms, maxPoints } = selectedInterval;
    // 按时间桶聚合：取每个桶内最后一条快照
    const buckets = new Map<number, EquitySnapshot>();
    for (const s of snapshots) {
      const bucket = Math.floor(s.timestamp / ms) * ms;
      buckets.set(bucket, s); // 同一桶内后面的覆盖前面的（取最新值）
    }
    const sorted = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-maxPoints);

    // 根据粒度选择时间格式
    const fmtTime = (ts: number) => {
      const d = new Date(ts);
      if (ms < 60 * 1000) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (ms < 24 * 60 * 60 * 1000) return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      if (ms < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      return d.toLocaleDateString('zh-CN', { year: '2-digit', month: 'short', day: 'numeric' });
    };
    return sorted.map(([bucket, s]) => ({
      time: fmtTime(bucket),
      value: s.totalValue,
    }));
  }, [snapshots, selectedInterval]);

  // 累计收益曲线：基于所有策略的 tradeRecords
  const cumulativeProfitData = useMemo(() => {
    if (!allTradeRecords.length) return [];
    const pairedTrades = allTradeRecords.filter(t => t.profit !== 0);
    if (!pairedTrades.length) return [];
    const sorted = [...pairedTrades].sort((a, b) => a.timestamp - b.timestamp);
    let cumulative = 0;
    // 按天聚合
    const dailyMap = new Map<string, number>();
    for (const t of sorted) {
      cumulative += t.profit;
      const d = new Date(t.timestamp);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      dailyMap.set(key, cumulative);
    }
    return Array.from(dailyMap.entries()).map(([day, cum]) => ({ day, cumulative: parseFloat(cum.toFixed(4)) }));
  }, [allTradeRecords]);

  // 第一个策略的成交价格曲线
  const firstStrategy = strategies[0] || null;
  const [tradeChartInterval, setTradeChartInterval] = useState<'1m' | '15m' | '1h' | '1d' | '1w'>('1h');

  const firstStrategyTrades = useLiveQuery(
    () => firstStrategy?.id
      ? db.tradeRecords.where('strategyId').equals(firstStrategy.id).sortBy('timestamp')
      : Promise.resolve([] as TradeRecord[]),
    [firstStrategy?.id]
  );

  const tradeChartData = useMemo(() => {
    if (!firstStrategyTrades?.length || !firstStrategy) return [];
    const msMap = { '1m': 60_000, '15m': 15 * 60_000, '1h': 3600_000, '1d': 86400_000, '1w': 7 * 86400_000 };
    const ms = msMap[tradeChartInterval];
    const buckets = new Map<number, { buyPrice: number | null; sellPrice: number | null; buyCount: number; sellCount: number }>();
    for (const t of firstStrategyTrades) {
      const bucket = Math.floor(t.timestamp / ms) * ms;
      const b = buckets.get(bucket) || { buyPrice: null, sellPrice: null, buyCount: 0, sellCount: 0 };
      if (t.side === 'buy') { b.buyPrice = t.price; b.buyCount++; }
      else { b.sellPrice = t.price; b.sellCount++; }
      buckets.set(bucket, b);
    }
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).slice(-200);
    const fmtTime = (ts: number) => {
      const d = new Date(ts);
      if (ms <= 60_000) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      if (ms <= 3600_000) return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    };
    return sorted.map(([bucket, b]) => ({
      time: fmtTime(bucket),
      buyPrice: b.buyPrice,
      sellPrice: b.sellPrice,
      buyCount: b.buyCount,
      sellCount: b.sellCount,
    }));
  }, [firstStrategyTrades, tradeChartInterval, firstStrategy]);

  // 进入仪表盘时触发利润重算
  const profitRecalced = useRef(false);
  useEffect(() => {
    if (profitRecalced.current || strategies.length === 0) return;
    profitRecalced.current = true;
    (async () => {
      for (const s of strategies) {
        if (s.id) { try { await updateStrategyProfit(s.id); } catch {} }
      }
    })();
  }, [strategies]);

  const totalAsset = accountInfo?.totalUsdtValue ?? 0;

  return (
    <div className={isMobile ? 'space-y-3' : 'space-y-6'}>
      {!isMobile && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">仪表盘</h1>
          <span className="text-sm text-slate-500 font-medium">
            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </span>
        </div>
      )}

      {/* Stats Grid */}
      <div className={isMobile ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4'}>
        <StatCard title="总资产" value={`$${totalAsset.toLocaleString()}`} icon={Wallet} color="blue" compact={isMobile} />
        <StatCard title="累计收益" value={`$${stats.totalProfit.toFixed(2)}`} icon={TrendingUp} color="green" compact={isMobile} />
        <StatCard title="今日收益" value={`$${stats.todayProfit.toFixed(2)}`} icon={stats.todayProfit >= 0 ? TrendingUp : TrendingDown} color={stats.todayProfit >= 0 ? 'green' : 'red'} compact={isMobile} />
        <StatCard title="运行策略" value={`${stats.running}`} sub={`共 ${strategies.length} 个`} icon={Activity} color="purple" compact={isMobile} />
        <StatCard title="胜率" value={`${stats.winRate}%`} sub={`${stats.totalTrades} 笔交易`} icon={Target} color="yellow" compact={isMobile} />
        <StatCard title="最大回撤" value={`${stats.maxDD.toFixed(2)}%`} icon={Zap} color="red" compact={isMobile} />
      </div>

      {/* Charts Row */}
      <div className={isMobile ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
        {/* Equity Curve */}
        <div className="card">
          <div className={isMobile ? 'mb-3' : 'flex items-center justify-between mb-4'}>
            <h3 className={`${isMobile ? 'text-sm mb-2' : 'text-base'} font-medium text-slate-400`}>净值曲线</h3>
            <div className={`flex items-center gap-1 ${isMobile ? 'overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none' : ''}`}>
              {INTERVALS.map(iv => (
                <button
                  key={iv.key}
                  className={`${isMobile ? 'px-2 py-0.5 text-xs' : 'px-2 py-1 text-sm'} rounded font-medium transition-all whitespace-nowrap ${
                    intervalKey === iv.key
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                  }`}
                  onClick={() => setIntervalKey(iv.key)}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>
          {chartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 250}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#94a3b8', fontSize: isMobile ? 9 : 11 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={{ stroke: '#334155' }}
                    tickSize={4}
                    tickMargin={isMobile ? 4 : 6}
                    interval="preserveStartEnd"
                    minTickGap={isMobile ? 30 : 40}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 11 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
                    width={isMobile ? 55 : 60}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: '12px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px -4px rgba(0,0,0,0.4)' }}
                    labelStyle={{ color: '#94a3b8', fontSize: 12 }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '净值']}
                  />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#colorValue)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 text-right mt-1`}>{chartData.length} 个数据点 · {selectedInterval.label}</p>
            </>
          ) : (
            <div className={`${isMobile ? 'h-[180px]' : 'h-[250px]'} flex items-center justify-center text-slate-600`}>
              <div className="text-center">
                <p>暂无数据</p>
                <p className={`${isMobile ? 'text-xs' : 'text-sm'} mt-1`}>账户资产数据将每次刷新时自动记录</p>
              </div>
            </div>
          )}
        </div>

        {/* Cumulative Profit Curve */}
        <div className="card">
          <h3 className={`${isMobile ? 'text-sm mb-2' : 'text-base mb-4'} font-medium text-slate-400`}>累计收益曲线</h3>
          {cumulativeProfitData.length > 0 ? (
            <ResponsiveContainer width="100%" height={isMobile ? 180 : 250}>
              <AreaChart data={cumulativeProfitData}>
                <defs>
                  <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={cumulativeProfitData[cumulativeProfitData.length - 1]?.cumulative >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={cumulativeProfitData[cumulativeProfitData.length - 1]?.cumulative >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.15)" />
                <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={50} />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.3)" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: '12px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px -4px rgba(0,0,0,0.4)' }}
                  labelStyle={{ color: '#94a3b8', fontSize: 12 }}
                  formatter={(v: any) => [`$${Number(v).toFixed(4)}`, '累计收益']}
                />
                <Area type="monotone" dataKey="cumulative" stroke={cumulativeProfitData[cumulativeProfitData.length - 1]?.cumulative >= 0 ? '#10b981' : '#ef4444'} fill="url(#cumulGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className={`${isMobile ? 'h-[180px]' : 'h-[250px]'} flex items-center justify-center text-slate-600`}>
              <div className="text-center">
                <p>暂无数据</p>
                <p className={`${isMobile ? 'text-xs' : 'text-sm'} mt-1`}>完成配对交易后将自动显示累计收益</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2: First Strategy Trade Chart + Strategy Overview */}
      <div className={isMobile ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
        {/* First Strategy Trade Price Chart */}
        <div className="card">
          <div className={isMobile ? 'mb-3' : 'flex items-center justify-between mb-4'}>
            <h3 className={`${isMobile ? 'text-sm mb-2' : 'text-base'} font-medium text-slate-400`}>
              {firstStrategy ? `${firstStrategy.symbol.replace('USDT', '')}/USDT 成交价格` : '成交价格曲线'}
            </h3>
            <div className="flex items-center gap-1">
              {firstStrategyTrades && <span className="text-xs text-slate-600 mr-1">{firstStrategyTrades.length}笔</span>}
              {(['1m', '15m', '1h', '1d', '1w'] as const).map(val => (
                <button key={val} onClick={() => setTradeChartInterval(val)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${tradeChartInterval === val ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}>
                  {{ '1m': '1分', '15m': '15分', '1h': '1时', '1d': '1天', '1w': '1周' }[val]}
                </button>
              ))}
            </div>
          </div>
          {tradeChartData.length > 0 && firstStrategy ? (() => {
            const cp = firstStrategy.centerPrice;
            const yMin = parseFloat((cp * 0.7).toFixed(6));
            const yMax = parseFloat((cp * 1.3).toFixed(6));
            const priceFmt = cp < 1 ? 6 : cp < 100 ? 4 : 2;
            return (
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
              <ComposedChart data={tradeChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.15)" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 10 }} axisLine={false} tickLine={false} domain={[yMin, yMax]} tickFormatter={(v: number) => v.toFixed(priceFmt)} width={cp < 1 ? 65 : 55} />
                <ReferenceLine y={cp} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `开仓 ${cp.toFixed(priceFmt)}`, position: 'right', fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: '12px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px -4px rgba(0,0,0,0.4)' }}
                  labelStyle={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}
                  formatter={(v: any, name: any, props: any) => {
                    if (v === null || v === undefined) return ['-', ''];
                    const entry = props.payload;
                    const label = name === 'buyPrice' ? '买入价' : '卖出价';
                    const count = name === 'buyPrice' ? entry.buyCount : entry.sellCount;
                    return [`${Number(v).toFixed(priceFmt)} (${count}笔)`, label];
                  }}
                />
                <Line type="monotone" dataKey="buyPrice" stroke="#10b981" strokeWidth={2} dot={{ r: 2, fill: '#10b981' }} connectNulls name="buyPrice" />
                <Line type="monotone" dataKey="sellPrice" stroke="#ef4444" strokeWidth={2} dot={{ r: 2, fill: '#ef4444' }} connectNulls name="sellPrice" />
              </ComposedChart>
            </ResponsiveContainer>
            );
          })() : (
            <div className={`${isMobile ? 'h-[200px]' : 'h-[260px]'} flex items-center justify-center text-slate-600`}>
              <div className="text-center">
                <p>暂无交易数据</p>
                <p className={`${isMobile ? 'text-xs' : 'text-sm'} mt-1`}>策略执行交易后将实时显示</p>
              </div>
            </div>
          )}
        </div>

        {/* Strategy Performance — Binance-style (same as StrategyManager) */}
        <div className="card">
          <h3 className={`${isMobile ? 'text-sm mb-3' : 'text-base mb-4'} font-medium text-slate-400`}>策略执行概览</h3>
          {strategies.length > 0 ? (
            <div className={isMobile ? 'space-y-3' : 'space-y-4'}>
              {strategies.map((s) => {
                const runtime = s.startedAt ? (() => {
                  const d = Date.now() - s.startedAt!;
                  const days = Math.floor(d / 86400000);
                  const hrs = Math.floor((d % 86400000) / 3600000);
                  const mins = Math.floor((d % 3600000) / 60000);
                  return days > 0 ? `${days}天 ${hrs}时` : hrs > 0 ? `${hrs}时 ${mins}分` : `${mins}分`;
                })() : '--';
                const ticker = tickers.get(s.symbol);
                const latestPrice = ticker ? parseFloat(ticker.price) : 0;
                const totalGridCount = s.layers.filter(l => l.enabled).reduce((a, l) => a + l.gridCount, 0);
                const perGridQty = s.totalFund > 0 && totalGridCount > 0 && latestPrice > 0
                  ? (s.totalFund / totalGridCount / latestPrice) : 0;
                // 浮动盈亏: 从网格订单计算未平仓持仓的盈亏
                const strategyOrders = allGridOrders.filter(o => o.strategyId === s.id && o.status === 'filled');
                const filledBuys = strategyOrders.filter(o => o.side === 'buy');
                const filledSells = strategyOrders.filter(o => o.side === 'sell');
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

                const px = isMobile ? 'px-3' : 'px-4';
                const cellText = isMobile ? 'text-xs' : 'text-sm';

                return (
                  <div key={s.id} className="rounded-xl bg-slate-800/50 border border-slate-700/30 overflow-hidden">
                    {/* Row 1: Symbol + Status */}
                    <div className={`flex items-center justify-between ${px} pt-2 pb-0.5`}>
                      <span className={`${cellText} text-slate-500`}>现货网格</span>
                    </div>
                    <div className={`flex items-center justify-between ${px} pb-1`}>
                      <p className={`${isMobile ? 'text-sm' : 'text-base'} font-bold`}>{s.symbol.replace('USDT', '')}/USDT</p>
                      <span className={`${cellText} font-medium ${
                        s.status === 'running' ? 'text-emerald-400' :
                        s.status === 'paused' ? 'text-yellow-400' :
                        s.status === 'error' ? 'text-red-400' : 'text-slate-400'
                      }`}>
                        {s.status === 'running' ? '运行中' : s.status === 'paused' ? '已暂停' : s.status === 'idle' ? '待启动' : '已停止'} &gt;
                      </span>
                    </div>

                    {/* Row 2: Creation time + Runtime */}
                    <div className={`${px} pb-2`}>
                      <p className={`${cellText} text-slate-500`}>
                        {isMobile
                          ? `${runtime !== '--' ? `运行 ${runtime}` : '未启动'}`
                          : `创建时间 ${new Date(s.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}${s.startedAt ? `, 运行时间 ${runtime}` : ''}`
                        }
                      </p>
                    </div>

                    {/* Row 3: Investment / Price Range / Grid Count */}
                    <div className={`grid ${isMobile ? 'grid-cols-2 gap-x-2 gap-y-1.5' : 'grid-cols-3 gap-3'} ${px} pb-2 ${cellText}`}>
                      <div>
                        <p className="text-slate-500 mb-0.5">{isMobile ? '投资额' : '总投资额 (USDT)'}</p>
                        <p className="font-semibold text-slate-200">{s.totalFund.toFixed(isMobile ? 2 : 5)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-0.5">{isMobile ? '价格范围' : '价格范围 (USDT)'}</p>
                        <p className="font-semibold text-slate-200">{s.lowerPrice.toFixed(isMobile ? 2 : 5)} - {s.upperPrice.toFixed(isMobile ? 2 : 5)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-0.5">网格数量</p>
                        <p className="font-semibold text-slate-200">{totalGridCount}</p>
                      </div>
                      {isMobile && (
                        <div>
                          <p className="text-slate-500 mb-0.5">最新价</p>
                          <p className="font-semibold text-slate-200">{latestPrice > 0 ? latestPrice.toFixed(latestPrice < 1 ? 5 : 2) : '--'}</p>
                        </div>
                      )}
                    </div>

                    {/* Row 4: Total Profit / Grid Profit / Unrealized PnL */}
                    <div className={`grid grid-cols-3 ${isMobile ? 'gap-1' : 'gap-3'} ${px} pb-2 ${cellText}`}>
                      <div>
                        <p className="text-slate-500 mb-0.5">{isMobile ? '总收益' : '总收益(USDT)'}</p>
                        <p className={`font-semibold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(isMobile ? 2 : 5)}
                        </p>
                        <p className={`${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {totalReturn >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-0.5">{isMobile ? '网格利润' : '网格利润(USDT)'}</p>
                        <p className={`font-semibold ${gridProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {gridProfit >= 0 ? '+' : ''}{gridProfit.toFixed(isMobile ? 2 : 5)}
                        </p>
                        <p className={`${gridProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {gridProfit >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-0.5">{isMobile ? '浮动盈亏' : '浮动盈亏(USDT)'}</p>
                        <p className={`font-semibold ${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(isMobile ? 2 : 5)}
                        </p>
                        <p className={`${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPct.toFixed(2)}%
                        </p>
                      </div>
                    </div>

                    {/* Row 5: Qty per trade / Matched count / Latest price (desktop only for latest price) */}
                    <div className={`grid ${isMobile ? 'grid-cols-2 gap-1' : 'grid-cols-3 gap-3'} ${px} pb-2.5 ${cellText}`}>
                      <div>
                        <p className="text-slate-500 mb-0.5">{isMobile ? '每笔数量' : `每笔数量 (${s.baseAsset})`}</p>
                        <p className="font-semibold text-slate-200">{perGridQty > 0 ? perGridQty.toFixed(perGridQty < 1 ? 5 : 2) : '--'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-0.5">成交/配对</p>
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
                          return <p className="font-semibold text-slate-200">{trades.length}笔 / {pairs}对</p>;
                        })()}
                      </div>
                      {!isMobile && (
                        <div>
                          <p className="text-slate-500 mb-0.5">最新价 (USDT)</p>
                          <p className="font-semibold text-slate-200">{latestPrice > 0 ? latestPrice.toFixed(latestPrice < 1 ? 5 : 2) : '--'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={`${isMobile ? 'h-[120px]' : 'h-[250px]'} flex items-center justify-center text-slate-600`}>暂无策略</div>
          )}
        </div>
      </div>
    </div>
  );
}
