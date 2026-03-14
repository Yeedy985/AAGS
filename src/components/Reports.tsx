import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { TradeRecord, EquitySnapshot } from '../types';
import { updateStrategyProfit } from '../services/strategyExecutor';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, Target, Calendar, DollarSign,
  BarChart3, Activity, Shield, ArrowUpRight, ArrowDownRight,
  FileText,
} from 'lucide-react';

const LAYER_COLORS: Record<string, string> = {
  trend: '#3b82f6',
  swing: '#10b981',
  spike: '#f97316',
};

const LAYER_NAMES: Record<string, string> = {
  trend: '趋势核心层',
  swing: '震荡波动层',
  spike: '插针收割层',
};

const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(15,23,42,0.95)',
  border: '1px solid rgba(51,65,85,0.4)',
  borderRadius: '12px',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 8px 32px -4px rgba(0,0,0,0.5)',
  padding: '10px 14px',
};

function ReportStatCard({ title, value, sub, icon: Icon, color, trend }: {
  title: string; value: string; sub?: string; icon: any; color: string; trend?: 'up' | 'down' | 'neutral';
}) {
  const colorMap: Record<string, { bg: string; border: string; iconBg: string; iconColor: string; valueColor: string }> = {
    blue:   { bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.12)', iconBg: 'rgba(59,130,246,0.12)', iconColor: 'text-blue-400', valueColor: 'text-blue-300' },
    green:  { bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.12)', iconBg: 'rgba(16,185,129,0.12)', iconColor: 'text-emerald-400', valueColor: 'text-emerald-300' },
    red:    { bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.12)', iconBg: 'rgba(239,68,68,0.12)', iconColor: 'text-red-400', valueColor: 'text-red-300' },
    yellow: { bg: 'rgba(234,179,8,0.06)', border: 'rgba(234,179,8,0.12)', iconBg: 'rgba(234,179,8,0.12)', iconColor: 'text-yellow-400', valueColor: 'text-yellow-300' },
    purple: { bg: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.12)', iconBg: 'rgba(139,92,246,0.12)', iconColor: 'text-violet-400', valueColor: 'text-violet-300' },
    cyan:   { bg: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.12)', iconBg: 'rgba(6,182,212,0.12)', iconColor: 'text-cyan-400', valueColor: 'text-cyan-300' },
    orange: { bg: 'rgba(249,115,22,0.06)', border: 'rgba(249,115,22,0.12)', iconBg: 'rgba(249,115,22,0.12)', iconColor: 'text-orange-400', valueColor: 'text-orange-300' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className="rounded-xl p-3.5 transition-all hover:scale-[1.02]" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.iconBg }}>
          <Icon className={`w-3.5 h-3.5 ${c.iconColor}`} />
        </div>
        <span className="text-xs text-slate-500 font-medium">{title}</span>
        {trend && trend !== 'neutral' && (
          <span className="ml-auto">
            {trend === 'up' ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
          </span>
        )}
      </div>
      <p className={`text-xl font-bold tracking-tight ${c.valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Reports() {
  const { strategies } = useStore();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'all'>('week');

  useEffect(() => {
    if (selectedId === null && strategies.length > 0) {
      setSelectedId(strategies[0].id!);
    }
  }, [strategies, selectedId]);

  // 进入报表页时：重算利润 + 写入最新快照
  const profitRecalced = useRef(false);
  useEffect(() => {
    if (profitRecalced.current || strategies.length === 0) return;
    profitRecalced.current = true;
    (async () => {
      for (const s of strategies) {
        if (s.id) {
          try { await updateStrategyProfit(s.id, true); } catch {}
        }
      }
    })();
  }, [strategies]);

  const selected = strategies.find((s) => s.id === selectedId);

  const periodStartTime = useMemo(() => {
    const now = Date.now();
    switch (period) {
      case 'day': return now - 24 * 60 * 60 * 1000;
      case 'week': return now - 7 * 24 * 60 * 60 * 1000;
      case 'month': return now - 30 * 24 * 60 * 60 * 1000;
      case 'all': return 0;
    }
  }, [period]);

  const trades = useLiveQuery(
    () => selectedId
      ? db.tradeRecords.where('strategyId').equals(selectedId)
          .and(t => t.timestamp >= periodStartTime)
          .toArray()
      : Promise.resolve([] as TradeRecord[]),
    [selectedId, periodStartTime]
  );

  const snapshots = useLiveQuery(
    () => selectedId
      ? db.equitySnapshots.where('strategyId').equals(selectedId)
          .and(s => s.timestamp >= periodStartTime)
          .sortBy('timestamp')
      : Promise.resolve([] as EquitySnapshot[]),
    [selectedId, periodStartTime]
  );

  const equityData = useMemo(() => {
    if (!snapshots?.length) return [];
    const ms = period === 'day' ? 5 * 60 * 1000
      : period === 'week' ? 60 * 60 * 1000
      : period === 'month' ? 4 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    const buckets = new Map<number, EquitySnapshot>();
    for (const s of snapshots) {
      const bucket = Math.floor(s.timestamp / ms) * ms;
      buckets.set(bucket, s);
    }
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).slice(-120);
    const fmtTime = (ts: number) => {
      const d = new Date(ts);
      if (ms < 60 * 60 * 1000) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      if (ms < 24 * 60 * 60 * 1000) return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    };
    return sorted.map(([bucket, s]) => ({
      time: fmtTime(bucket),
      total: s.totalValue,
      coin: s.coinValue,
      usdt: s.usdtValue,
      unrealizedPnl: s.unrealizedPnl,
    }));
  }, [snapshots, period]);

  const layerPieData = useMemo(() => {
    if (!trades?.length) return [];
    const stats: Record<string, { profit: number; count: number }> = {};
    trades.forEach((t) => {
      if (!stats[t.layer]) stats[t.layer] = { profit: 0, count: 0 };
      stats[t.layer].profit += t.profit;
      stats[t.layer].count++;
    });
    return Object.entries(stats).map(([layer, { profit, count }]) => ({
      name: LAYER_NAMES[layer] || layer,
      value: Math.abs(profit),
      color: LAYER_COLORS[layer] || '#6366f1',
      profit,
      count,
    }));
  }, [trades]);

  const dailyPnL = useMemo(() => {
    if (!trades?.length) return [];
    const dailyMap: Record<string, { pnl: number; count: number }> = {};
    trades.forEach((t) => {
      const d = new Date(t.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!dailyMap[key]) dailyMap[key] = { pnl: 0, count: 0 };
      dailyMap[key].pnl += t.profit;
      dailyMap[key].count++;
    });
    return Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([key, { pnl, count }]) => {
        const [, m, d] = key.split('-');
        return { day: `${parseInt(m)}/${parseInt(d)}`, pnl: parseFloat(pnl.toFixed(4)), count };
      });
  }, [trades]);

  const cumulativePnL = useMemo(() => {
    if (!dailyPnL.length) return [];
    let cumulative = 0;
    return dailyPnL.map(d => {
      cumulative += d.pnl;
      return { day: d.day, cumulative: parseFloat(cumulative.toFixed(4)), daily: d.pnl };
    });
  }, [dailyPnL]);

  const summaryStats = useMemo(() => {
    if (!selected) return null;
    const periodTrades = trades || [];
    const totalTrades = periodTrades.length;

    // 只统计已配对的交易（profit !== 0 的卖单）
    const pairedTrades = periodTrades.filter(t => t.profit !== 0);
    const pairedCount = pairedTrades.length || selected.totalTrades;
    const winCount = pairedTrades.length > 0
      ? pairedTrades.filter(t => t.profit > 0).length
      : selected.winTrades;
    const loseCount = pairedTrades.length > 0
      ? pairedTrades.filter(t => t.profit < 0).length
      : (selected.totalTrades - selected.winTrades);
    const winRate = pairedCount > 0 ? (winCount / pairedCount * 100).toFixed(1) : '0.0';
    const totalProfit = pairedTrades.length > 0
      ? pairedTrades.reduce((s, t) => s + t.profit, 0)
      : selected.totalProfit;
    const avgProfit = pairedCount > 0 ? totalProfit / pairedCount : 0;
    const totalFees = periodTrades.length > 0
      ? periodTrades.reduce((s, t) => s + t.fee, 0)
      : 0;

    const avgWin = winCount > 0
      ? pairedTrades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0) / winCount
      : 0;
    const avgLoss = loseCount > 0
      ? Math.abs(pairedTrades.filter(t => t.profit < 0).reduce((s, t) => s + t.profit, 0)) / loseCount
      : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    const daysRunning = selected.startedAt
      ? Math.max(1, Math.floor((Date.now() - selected.startedAt) / 86400000))
      : 0;
    const periodDays = period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : daysRunning;
    const dailyReturn = periodDays > 0 ? totalProfit / periodDays : 0;
    const annualReturn = daysRunning > 0
      ? ((selected.totalProfit / selected.totalFund) * (365 / daysRunning) * 100)
      : 0;

    return {
      totalTrades,
      winCount,
      loseCount,
      winRate,
      avgProfit,
      totalProfit,
      totalFees,
      profitFactor,
      daysRunning,
      dailyReturn,
      annualReturn,
      maxDrawdown: selected.maxDrawdown,
    };
  }, [selected, trades, period]);

  const periodLabel = period === 'day' ? '今日' : period === 'week' ? '近7天' : period === 'month' ? '近30天' : '全部';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">数据报表</h1>
        {selected && (
          <span className="text-xs text-slate-500">
            {selected.symbol} · {periodLabel} · {summaryStats?.totalTrades ?? 0} 笔交易
          </span>
        )}
      </div>

      {strategies.length === 0 ? (
        <div className="card py-20 text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400 font-medium">暂无策略数据</p>
          <p className="text-sm text-slate-600 mt-1">创建并运行策略后，交易数据将自动记录在此</p>
        </div>
      ) : (
        <>
          {/* Selector Row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5 flex-wrap flex-1">
              {strategies.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id!)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    selectedId === s.id
                      ? 'text-white shadow-lg'
                      : 'text-slate-400 hover:text-slate-200 border border-slate-700/40 hover:border-slate-600/60'
                  }`}
                  style={selectedId === s.id ? { background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', boxShadow: '0 2px 12px -2px rgba(99,102,241,0.35)' } : { background: 'rgba(30,41,59,0.5)' }}
                >
                  {s.name}
                  <span className={`ml-1.5 text-xs ${selectedId === s.id ? 'text-white/60' : 'text-slate-600'}`}>
                    {s.status === 'running' ? '●' : '○'}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid rgba(51,65,85,0.3)' }}>
              {([['day', '日'], ['week', '周'], ['month', '月'], ['all', '全部']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all duration-200 ${
                    period === key
                      ? 'text-white bg-blue-600/80 shadow-sm'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary Stats Cards */}
          {summaryStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
              <ReportStatCard
                title={`${periodLabel}收益`}
                value={`${summaryStats.totalProfit >= 0 ? '+' : ''}$${summaryStats.totalProfit.toFixed(2)}`}
                icon={DollarSign}
                color="green"
                trend={summaryStats.totalProfit > 0 ? 'up' : summaryStats.totalProfit < 0 ? 'down' : 'neutral'}
              />
              <ReportStatCard
                title="胜率"
                value={`${summaryStats.winRate}%`}
                sub={`${summaryStats.winCount}胜 ${summaryStats.loseCount}负`}
                icon={Target}
                color="yellow"
              />
              <ReportStatCard
                title="总交易"
                value={String(summaryStats.totalTrades)}
                sub={`${periodLabel}数据`}
                icon={BarChart3}
                color="blue"
              />
              <ReportStatCard
                title="均笔收益"
                value={`$${summaryStats.avgProfit.toFixed(4)}`}
                icon={Activity}
                color="cyan"
                trend={summaryStats.avgProfit > 0 ? 'up' : summaryStats.avgProfit < 0 ? 'down' : 'neutral'}
              />
              <ReportStatCard
                title="日均收益"
                value={`$${summaryStats.dailyReturn.toFixed(2)}`}
                icon={Calendar}
                color="orange"
              />
              <ReportStatCard
                title="年化收益"
                value={`${summaryStats.annualReturn.toFixed(1)}%`}
                sub={`运行${summaryStats.daysRunning}天`}
                icon={TrendingUp}
                color="purple"
              />
              <ReportStatCard
                title="最大回撤"
                value={`${summaryStats.maxDrawdown.toFixed(2)}%`}
                icon={Shield}
                color="red"
              />
            </div>
          )}

          {/* Charts Row 1: Equity + Daily PnL */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Equity Curve */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                  策略净值曲线
                </h3>
                {equityData.length > 0 && (
                  <span className="text-xs text-slate-600">{equityData.length} 个数据点</span>
                )}
              </div>
              {equityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={equityData}>
                    <defs>
                      <linearGradient id="reportGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.15)" />
                    <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`} width={58} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}
                      formatter={(v: any) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '净值']}
                    />
                    <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="url(#reportGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart text="暂无净值数据" sub="策略运行后将自动记录资产变化" />
              )}
            </div>

            {/* Daily PnL */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-orange-400" />
                  每日盈亏
                </h3>
                {dailyPnL.length > 0 && (() => {
                  const totalPnl = dailyPnL.reduce((s, d) => s + d.pnl, 0);
                  const winDays = dailyPnL.filter(d => d.pnl > 0).length;
                  return (
                    <span className="text-xs text-slate-600">
                      {winDays}/{dailyPnL.length} 天盈利 · 合计 <span className={totalPnl >= 0 ? 'text-emerald-500' : 'text-red-400'}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}</span>
                    </span>
                  );
                })()}
              </div>
              {dailyPnL.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyPnL}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.15)" />
                    <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={50} />
                    <ReferenceLine y={0} stroke="rgba(148,163,184,0.2)" />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}
                      formatter={(v: any, _: any, props: any) => {
                        const entry = props.payload;
                        return [`$${Number(v).toFixed(4)} (${entry.count}笔)`, '盈亏'];
                      }}
                    />
                    <Bar dataKey="pnl" name="盈亏" radius={[3, 3, 0, 0]}>
                      {dailyPnL.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? '#f97316' : '#3b82f6'} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart text="暂无交易记录" sub="完成交易后将按日汇总盈亏" />
              )}
            </div>
          </div>

          {/* Charts Row 2: Cumulative PnL + Holdings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cumulative PnL Curve */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-purple-400" />
                  累计收益曲线
                </h3>
                {cumulativePnL.length > 0 && (
                  <span className={`text-xs font-medium ${cumulativePnL[cumulativePnL.length - 1].cumulative >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {cumulativePnL[cumulativePnL.length - 1].cumulative >= 0 ? '+' : ''}${cumulativePnL[cumulativePnL.length - 1].cumulative.toFixed(2)}
                  </span>
                )}
              </div>
              {cumulativePnL.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={cumulativePnL}>
                    <defs>
                      <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.15)" />
                    <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} width={50} />
                    <ReferenceLine y={0} stroke="rgba(148,163,184,0.3)" strokeDasharray="4 4" />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}
                      formatter={(v: any, name: any) => [
                        `$${Number(v).toFixed(4)}`,
                        name === 'cumulative' ? '累计收益' : '当日盈亏',
                      ]}
                    />
                    <Area type="monotone" dataKey="cumulative" stroke="#8b5cf6" fill="url(#cumulGrad)" strokeWidth={2} dot={false} name="cumulative" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart text="暂无累计数据" sub="交易数据将自动汇总" />
              )}
            </div>

            {/* Layer Profit Pie */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <Target className="w-4 h-4 text-cyan-400" />
                  各层收益分布
                </h3>
              </div>
              {layerPieData.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={240}>
                    <PieChart>
                      <Pie
                        data={layerPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        dataKey="value"
                        nameKey="name"
                        strokeWidth={0}
                      >
                        {layerPieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.profit >= 0 ? entry.color : '#ef4444'} opacity={entry.profit >= 0 ? 0.85 : 0.6} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v: any, name: any) => {
                          const item = layerPieData.find(d => d.name === name);
                          return [`${item?.profit && item.profit >= 0 ? '+' : ''}$${item?.profit?.toFixed(4) ?? v} (${item?.count ?? 0}笔)`, name];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-3">
                    {layerPieData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.profit >= 0 ? entry.color : '#ef4444' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400">{entry.name}</p>
                          <div className="flex items-baseline gap-2">
                            <p className={`text-sm font-bold ${entry.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {entry.profit >= 0 ? '+' : ''}${entry.profit.toFixed(4)}
                            </p>
                            <span className="text-xs text-slate-600">{entry.count}笔</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyChart text="暂无层级数据" sub="交易后将按趋势/震荡/插针层分类统计" />
              )}
            </div>

          </div>
        </>
      )}
    </div>
  );
}

function EmptyChart({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="h-[260px] flex flex-col items-center justify-center">
      <BarChart3 className="w-8 h-8 text-slate-700 mb-2" />
      <p className="text-sm text-slate-500">{text}</p>
      <p className="text-xs text-slate-600 mt-0.5">{sub}</p>
    </div>
  );
}
