import { useState } from 'react';
import { Shield, AlertTriangle, TrendingDown, BarChart2, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { db } from '../db';
import type { Strategy, RiskConfig } from '../types';

export default function RiskControl() {
  const { strategies, updateStrategy } = useStore();
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(strategies[0]?.id ?? null);

  const selected = strategies.find((s) => s.id === selectedId);

  const updateRisk = async (updates: Partial<RiskConfig>) => {
    if (!selected) return;
    const updated: Strategy = {
      ...selected,
      risk: { ...selected.risk, ...updates },
    };
    await db.strategies.update(selected.id!, { risk: updated.risk });
    updateStrategy(updated);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">{t('risk.title')}</h1>
      </div>

      {strategies.length === 0 ? (
        <div className="card py-16 text-center text-slate-500">{t('risk.noStrategies')}</div>
      ) : (
        <>
          {/* Strategy Selector */}
          <div className="flex gap-2 flex-wrap">
            {strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id!)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  selectedId === s.id
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                style={selectedId === s.id ? { background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', boxShadow: '0 2px 10px -2px rgba(99,102,241,0.4)' } : { background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(51,65,85,0.3)' }}
              >
                {s.name}
              </button>
            ))}
          </div>

          {selected && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Circuit Break */}
              <div className="card space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.05) 100%)' }}>
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{t('risk.circuitBreak.title')}</h3>
                    <p className="text-sm text-slate-500">{t('risk.circuitBreak.desc')}</p>
                  </div>
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.risk.circuitBreakEnabled}
                    onChange={(e) => updateRisk({ circuitBreakEnabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">{t('risk.circuitBreak.enable')}</span>
                </label>
                {selected.risk.circuitBreakEnabled && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-slate-500 block mb-1">{t('risk.circuitBreak.dropThreshold')}</label>
                      <input
                        className="input-field"
                        type="number"
                        step="0.5"
                        value={selected.risk.circuitBreakDropPercent}
                        onChange={(e) => updateRisk({ circuitBreakDropPercent: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-500 block mb-1">{t('risk.circuitBreak.volumeMultiple')}</label>
                      <input
                        className="input-field"
                        type="number"
                        step="0.5"
                        value={selected.risk.circuitBreakVolumeMultiple}
                        onChange={(e) => updateRisk({ circuitBreakVolumeMultiple: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Daily Drawdown */}
              <div className="card space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.15) 0%, rgba(234,179,8,0.05) 100%)' }}>
                    <TrendingDown className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{t('risk.dailyDrawdown.title')}</h3>
                    <p className="text-sm text-slate-500">{t('risk.dailyDrawdown.desc')}</p>
                  </div>
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.risk.dailyDrawdownEnabled}
                    onChange={(e) => updateRisk({ dailyDrawdownEnabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">{t('risk.dailyDrawdown.enable')}</span>
                </label>
                {selected.risk.dailyDrawdownEnabled && (
                  <div>
                    <label className="text-sm text-slate-500 block mb-1">{t('risk.dailyDrawdown.maxPercent')}</label>
                    <input
                      className="input-field"
                      type="number"
                      step="0.5"
                      value={selected.risk.dailyDrawdownPercent}
                      onChange={(e) => updateRisk({ dailyDrawdownPercent: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>

              {/* Max Position */}
              <div className="card space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)' }}>
                    <BarChart2 className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{t('risk.maxPosition.title')}</h3>
                    <p className="text-sm text-slate-500">{t('risk.maxPosition.desc')}</p>
                  </div>
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.risk.maxPositionEnabled}
                    onChange={(e) => updateRisk({ maxPositionEnabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">{t('risk.maxPosition.enable')}</span>
                </label>
                {selected.risk.maxPositionEnabled && (
                  <div>
                    <label className="text-sm text-slate-500 block mb-1">{t('risk.maxPosition.maxPercent')}</label>
                    <input
                      className="input-field"
                      type="number"
                      step="5"
                      value={selected.risk.maxPositionPercent}
                      onChange={(e) => updateRisk({ maxPositionPercent: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>

              {/* Trend Defense */}
              <div className="card space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.05) 100%)' }}>
                    <Activity className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{t('risk.trendDefense.title')}</h3>
                    <p className="text-sm text-slate-500">{t('risk.trendDefense.desc')}</p>
                  </div>
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.risk.trendDefenseEnabled}
                    onChange={(e) => updateRisk({ trendDefenseEnabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">{t('risk.trendDefense.enable')}</span>
                </label>
                {selected.risk.trendDefenseEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm text-slate-500 block mb-1">{t('risk.trendDefense.emaFast')}</label>
                      <input
                        className="input-field"
                        type="number"
                        value={selected.risk.trendDefenseEmaFast}
                        onChange={(e) => updateRisk({ trendDefenseEmaFast: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-500 block mb-1">{t('risk.trendDefense.emaSlow')}</label>
                      <input
                        className="input-field"
                        type="number"
                        value={selected.risk.trendDefenseEmaSlow}
                        onChange={(e) => updateRisk({ trendDefenseEmaSlow: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status Overview */}
          {selected && (
            <div className="card">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-400" />
                {t('risk.statusOverview')}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className={`p-3 rounded-lg text-center ${
                  selected.status === 'circuit_break' ? 'bg-red-900/30 text-red-400' : 'bg-emerald-900/20 text-emerald-400'
                }`}>
                  {selected.status === 'circuit_break' ? `⚠️ ${t('risk.status.circuitBreak')}` : `✓ ${t('risk.status.normal')}`}
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)' }}>
                  <span className="text-sm text-slate-500">{t('risk.status.maxDrawdown')}</span><br/><span className="font-mono font-bold">{selected.maxDrawdown.toFixed(2)}%</span>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)' }}>
                  <span className="text-sm text-slate-500">{t('risk.status.todayPnl')}</span><br/><span className={`font-mono font-bold ${selected.todayProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {selected.todayProfit >= 0 ? '+' : ''}{selected.todayProfit.toFixed(2)}
                  </span>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)' }}>
                  <span className="text-sm text-slate-500">{t('risk.status.strategyStatus')}</span><br/>{selected.status === 'running' ? `🟢 ${t('strategy.status.running')}` : selected.status === 'paused' ? `🟡 ${t('strategy.status.paused')}` : `⚪ ${t('strategy.status.stopped')}`}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
