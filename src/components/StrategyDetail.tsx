import type { Strategy } from '../types';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '../hooks/useIsMobile';

const LAYER_COLORS: Record<string, string> = {
  trend: '#3b82f6',
  swing: '#10b981',
  spike: '#f97316',
};

const LAYER_NAME_KEYS: Record<string, string> = {
  trend: 'strategy.layerFull.trend',
  swing: 'strategy.layerFull.swing',
  spike: 'strategy.layerFull.spike',
};

export default function StrategyDetail({ strategy }: { strategy: Strategy }) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  return (
    <div className={isMobile ? 'space-y-3' : 'space-y-4'}>
      {/* Config Overview */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 md:grid-cols-4 gap-3'} ${isMobile ? 'text-xs' : 'text-sm'}`}>
        <div className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(51,65,85,0.25)' }}>
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('detail.rangeMode')}</p>
          <p className={`font-bold mt-1 tracking-tight ${isMobile ? 'text-sm' : ''}`}>{t(`detail.rangeModeNames.${strategy.rangeMode}`)}</p>
        </div>
        <div className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.06) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(51,65,85,0.25)' }}>
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('detail.profitAllocation')}</p>
          <p className={`font-bold mt-1 tracking-tight ${isMobile ? 'text-sm' : ''}`}>{t(`detail.profitAllocationNames.${strategy.profitAllocation}`)}</p>
        </div>
        <div className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(51,65,85,0.25)' }}>
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('detail.totalTrades')}</p>
          <p className={`font-bold mt-1 tracking-tight ${isMobile ? 'text-sm' : ''}`}>{strategy.totalTrades}</p>
        </div>
        <div className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(234,179,8,0.06) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(51,65,85,0.25)' }}>
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('detail.winRate')}</p>
          <p className={`font-bold mt-1 tracking-tight ${isMobile ? 'text-sm' : ''}`}>
            {strategy.totalTrades > 0 ? (strategy.winTrades / strategy.totalTrades * 100).toFixed(1) : '0.0'}%
          </p>
        </div>
      </div>

      {/* Grid Layers */}
      <div className={`grid ${isMobile ? 'grid-cols-1 gap-2' : 'grid-cols-1 md:grid-cols-3 gap-3'}`}>
        {strategy.layers.filter((l) => l.enabled).map((layer) => (
          <div key={layer.layer} className={`${isMobile ? 'p-3' : 'p-3.5'} rounded-xl border-l-4 transition-all duration-200 hover:translate-y-[-1px]`} style={{ borderLeftColor: LAYER_COLORS[layer.layer], background: 'linear-gradient(135deg, rgba(15,23,42,0.6) 0%, rgba(30,41,59,0.3) 100%)', boxShadow: '0 2px 8px -2px rgba(0,0,0,0.15)', border: `1px solid rgba(51,65,85,0.25)`, borderLeft: `4px solid ${LAYER_COLORS[layer.layer]}` }}>
            <p className={`font-bold ${isMobile ? 'text-xs' : 'text-sm'}`}>{t(LAYER_NAME_KEYS[layer.layer])}</p>
            <div className={`mt-1.5 space-y-0.5 ${isMobile ? 'text-xs' : 'text-sm'} text-slate-400`}>
              <p>{t('detail.gridCount')}: <span className="text-slate-200 font-medium">{layer.gridCount}</span></p>
              <p>{t('detail.profitRate')}: <span className="text-slate-200 font-medium">{layer.profitRate}%</span></p>
              <p>{t('detail.fundRatio')}: <span className="text-slate-200 font-medium">{(layer.fundRatio * 100).toFixed(0)}%</span></p>
              <p>{t('detail.range')}: <span className="text-slate-200 font-medium">{layer.lowerPrice.toFixed(2)} - {layer.upperPrice.toFixed(2)}</span></p>
            </div>
          </div>
        ))}
      </div>

      {/* Risk Config */}
      <div>
        <h4 className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-400 mb-2`}>{t('detail.riskConfig')}</h4>
        <div className={`grid ${isMobile ? 'grid-cols-2 gap-1.5' : 'grid-cols-2 md:grid-cols-4 gap-2'} ${isMobile ? 'text-xs' : 'text-sm'}`}>
          <div className={`p-2.5 rounded-xl font-medium ${strategy.risk.circuitBreakEnabled ? 'text-emerald-400' : 'text-slate-500'}`} style={strategy.risk.circuitBreakEnabled ? { background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)', border: '1px solid rgba(16,185,129,0.15)' } : { background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(51,65,85,0.2)' }}>
            {t('detail.circuitBreak')} {strategy.risk.circuitBreakEnabled ? `≤-${strategy.risk.circuitBreakDropPercent}%` : t('common.off')}
          </div>
          <div className={`p-2.5 rounded-xl font-medium ${strategy.risk.dailyDrawdownEnabled ? 'text-emerald-400' : 'text-slate-500'}`} style={strategy.risk.dailyDrawdownEnabled ? { background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)', border: '1px solid rgba(16,185,129,0.15)' } : { background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(51,65,85,0.2)' }}>
            {t('detail.dailyDrawdown')} {strategy.risk.dailyDrawdownEnabled ? `≤${strategy.risk.dailyDrawdownPercent}%` : t('common.off')}
          </div>
          <div className={`p-2.5 rounded-xl font-medium ${strategy.risk.maxPositionEnabled ? 'text-emerald-400' : 'text-slate-500'}`} style={strategy.risk.maxPositionEnabled ? { background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)', border: '1px solid rgba(16,185,129,0.15)' } : { background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(51,65,85,0.2)' }}>
            {t('detail.positionLimit')} {strategy.risk.maxPositionEnabled ? `≤${strategy.risk.maxPositionPercent}%` : t('common.off')}
          </div>
          <div className={`p-2.5 rounded-xl font-medium ${strategy.risk.trendDefenseEnabled ? 'text-emerald-400' : 'text-slate-500'}`} style={strategy.risk.trendDefenseEnabled ? { background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)', border: '1px solid rgba(16,185,129,0.15)' } : { background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(51,65,85,0.2)' }}>
            {t('detail.trendDefense')} {strategy.risk.trendDefenseEnabled ? t('common.on') : t('common.off')}
          </div>
        </div>
      </div>
    </div>
  );
}
