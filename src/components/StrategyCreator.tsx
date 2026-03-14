import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, ChevronDown, XCircle, Wand2, Eraser, HelpCircle, Loader2, CheckCircle, AlertCircle, Wallet } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getPrice, getKlines, getExchangeInfo, getAccountInfo, setCurrentExchange } from '../services/binance';
import { getExchangeConfig } from '../services/exchangeConfig';
import { calculateATR, calculateAdaptiveRange, getVolatilityLevel } from '../services/gridEngine';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Strategy, GridLayerConfig, RiskConfig, RangeMode, ProfitAllocation, EndMode, ApiConfig, AssetBalance } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTranslation } from 'react-i18next';

interface Props {
  onCreated: (strategy: Strategy) => void;
  onCancel: () => void;
}

const defaultRisk: RiskConfig = {
  circuitBreakEnabled: true,
  circuitBreakDropPercent: 5,
  circuitBreakVolumeMultiple: 5,
  dailyDrawdownEnabled: true,
  dailyDrawdownPercent: 5,
  maxPositionEnabled: true,
  maxPositionPercent: 80,
  trendDefenseEnabled: true,
  trendDefenseEmaFast: 12,
  trendDefenseEmaSlow: 26,
};

const defaultLayers: GridLayerConfig[] = [
  { layer: 'trend', enabled: true, gridCount: 10, upperPrice: 0, lowerPrice: 0, rangeRatio: 1.0, fundRatio: 0.3, profitRate: 3, profitMode: 'distance_increase',
    fixedProfitRate: 3, perGridMinRate: 2, perGridMaxRate: 5, distBaseRate: 1.5, distIncreaseStep: 0.3, distMaxRate: 8, trendBaseRate: 3, trendBullMultiplier: 0.8, trendBearMultiplier: 1.5 },
  { layer: 'swing', enabled: true, gridCount: 30, upperPrice: 0, lowerPrice: 0, rangeRatio: 0.6, fundRatio: 0.5, profitRate: 1.5, profitMode: 'fixed_rate',
    fixedProfitRate: 1.5, perGridMinRate: 0.8, perGridMaxRate: 3, distBaseRate: 1, distIncreaseStep: 0.2, distMaxRate: 4, trendBaseRate: 1.5, trendBullMultiplier: 0.8, trendBearMultiplier: 1.3 },
  { layer: 'spike', enabled: true, gridCount: 4, upperPrice: 0, lowerPrice: 0, rangeRatio: 1.5, fundRatio: 0.2, profitRate: 10, profitMode: 'fixed_rate',
    fixedProfitRate: 10, perGridMinRate: 10, perGridMaxRate: 30, distBaseRate: 5, distIncreaseStep: 2, distMaxRate: 30, trendBaseRate: 10, trendBullMultiplier: 0.7, trendBearMultiplier: 2 },
];

export default function StrategyCreator({ onCreated, onCancel }: Props) {
  const { symbols, setSymbols, apiConfig } = useStore();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const savedConfigs = useLiveQuery(() => db.apiConfigs.toArray(), []);
  const [selectedAccount, setSelectedAccount] = useState<ApiConfig | null>(null);

  // 连接检测状态
  const [checking, setChecking] = useState(false);
  const [connectionOk, setConnectionOk] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [localBalances, setLocalBalances] = useState<AssetBalance[]>([]);
  const [localTotalUsdt, setLocalTotalUsdt] = useState(0);

  // 选择账户后自动检测连接
  const handleCheckConnection = useCallback(async (account: ApiConfig) => {
    setChecking(true);
    setConnectionOk(false);
    setConnectionError('');
    setLocalBalances([]);
    setLocalTotalUsdt(0);
    try {
      setCurrentExchange(account.exchange || 'binance');
      const data = await getAccountInfo(account.apiKey, account.apiSecret);
      const cfg = getExchangeConfig(account.exchange || 'binance');
      let total = 0;
      for (const balance of data.balances) {
        if (cfg.quoteAssets.includes(balance.asset)) {
          balance.usdtValue = parseFloat(balance.free) + parseFloat(balance.locked);
        } else {
          try {
            const price = await getPrice(`${balance.asset}USDT`);
            balance.usdtValue = (parseFloat(balance.free) + parseFloat(balance.locked)) * price;
          } catch {
            balance.usdtValue = 0;
          }
        }
        total += balance.usdtValue;
      }
      setLocalBalances(data.balances.sort((a, b) => b.usdtValue - a.usdtValue));
      setLocalTotalUsdt(total);
      setConnectionOk(true);
    } catch (err: any) {
      setConnectionError(err.message || t('connection.connectionFailed'));
    }
    setChecking(false);
  }, []);

  // 自动选择当前活跃账户并检测连接
  useEffect(() => {
    if (!selectedAccount && apiConfig) {
      setSelectedAccount(apiConfig);
      handleCheckConnection(apiConfig);
    }
  }, [apiConfig, selectedAccount, handleCheckConnection]);

  const handleSelectAccount = (config: ApiConfig) => {
    setSelectedAccount(config);
    setCurrentExchange(config.exchange || 'binance');
    setConnectionOk(false);
    setConnectionError('');
    handleCheckConnection(config);
  };
  const [step, setStep] = useState(1);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [symbol, setSymbol] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [totalFund, setTotalFund] = useState(1000);
  const [entryPrice, setEntryPrice] = useState(0);
  const [rangeMode, setRangeMode] = useState<RangeMode>('fixed');
  const [upperPrice, setUpperPrice] = useState(0);
  const [lowerPrice, setLowerPrice] = useState(0);
  const [atrPeriod] = useState(14);
  const [atrMultiplier] = useState(2);
  const [layers, setLayers] = useState<GridLayerConfig[]>(defaultLayers);
  const [profitAllocation, setProfitAllocation] = useState<ProfitAllocation>('ratio');
  const [profitRatio, setProfitRatio] = useState(50);
  const [reinvestMode, setReinvestMode] = useState<'per_grid' | 'whole_strategy'>('per_grid');
  const [thresholdHoldCoinPrice, setThresholdHoldCoinPrice] = useState(0);
  const [thresholdHoldUsdtPrice, setThresholdHoldUsdtPrice] = useState(0);
  const [endMode, setEndMode] = useState<EndMode>('keep_position');
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [volatility, setVolatility] = useState({ level: '', percent: 0 });
  const [, setLoading] = useState(false);

  useEffect(() => {
    if (symbols.length === 0) {
      getExchangeInfo().then(setSymbols);
    }
  }, [symbols, setSymbols]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const popularBases = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];
  const filteredSymbols = symbols.filter((s) => {
    if (!symbolSearch.trim()) {
      return popularBases.includes(s.baseAsset);
    }
    const q = symbolSearch.toUpperCase();
    return s.symbol.includes(q) || s.baseAsset.includes(q);
  }).slice(0, 30);

  const handleClearSymbol = () => {
    setSymbol('');
    setSymbolSearch('');
    setCurrentPrice(0);
    setVolatility({ level: '', percent: 0 });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const selectSymbol = async (sym: string) => {
    setSymbol(sym);
    setSymbolSearch(sym.replace('USDT', ''));
    setLoading(true);
    try {
      const [price, klines] = await Promise.all([
        getPrice(sym),
        getKlines(sym, '1h', 100),
      ]);
      setCurrentPrice(price);
      setEntryPrice(price);
      const atr = calculateATR(klines, atrPeriod);
      const vol = getVolatilityLevel(atr, price);
      setVolatility(vol);

      if (rangeMode === 'volatility') {
        const range = calculateAdaptiveRange(price, atr, atrMultiplier);
        setUpperPrice(parseFloat(range.upper.toFixed(2)));
        setLowerPrice(parseFloat(range.lower.toFixed(2)));
        updateLayerPrices(range.lower, range.upper);
      }
      if (!name) setName(t('creator.defaultStrategyName', { symbol: sym.replace('USDT', '') }));
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const updateLayerPrices = (lower: number, upper: number) => {
    const halfRange = (upper - lower) / 2;
    const center = entryPrice > 0 ? entryPrice : (upper + lower) / 2;
    setLayers((prev) => prev.map((l) => {
      const h = halfRange * l.rangeRatio;
      return { ...l, upperPrice: +(center + h).toFixed(2), lowerPrice: +(center - h).toFixed(2) };
    }));
  };

  const updateLayer = (index: number, updates: Partial<GridLayerConfig>) => {
    setLayers((prev) => {
      const next = prev.map((l, i) => i === index ? { ...l, ...updates } : l);
      // Auto-balance fundRatio to always sum to 100%
      if ('fundRatio' in updates) {
        const changedVal = updates.fundRatio!;
        const enabledOthers = next.filter((l, i) => i !== index && l.enabled);
        const remaining = 1 - changedVal;
        if (enabledOthers.length > 0) {
          const othersSum = enabledOthers.reduce((s, l) => s + l.fundRatio, 0);
          return next.map((l, i) => {
            if (i === index) return l;
            if (!l.enabled) return l;
            const share = othersSum > 0 ? l.fundRatio / othersSum : 1 / enabledOthers.length;
            return { ...l, fundRatio: Math.max(0, +(remaining * share).toFixed(4)) };
          });
        }
      }
      return next;
    });
  };

  const handleCreate = () => {
    const baseAsset = symbol.replace('USDT', '');
    const strategy: Strategy = {
      name,
      symbol,
      baseAsset,
      quoteAsset: 'USDT',
      status: 'idle',
      totalFund,
      usedFund: 0,
      rangeMode,
      upperPrice,
      lowerPrice,
      centerPrice: currentPrice,
      atrPeriod,
      atrMultiplier,
      layers,
      profitAllocation,
      profitRatio,
      profitThreshold: 10,
      trendSellAbovePercent: 10,
      trendBuyBelowPercent: 10,
      risk: defaultRisk,
      autoRebalance,
      rebalanceStepPercent: 5,
      endMode,
      totalProfit: 0,
      todayProfit: 0,
      totalTrades: 0,
      winTrades: 0,
      maxDrawdown: 0,
      createdAt: Date.now(),
    };
    onCreated(strategy);
  };

  const layerNames: Record<string, string> = { trend: t('strategy.layerFull.trend'), swing: t('strategy.layerFull.swing'), spike: t('strategy.layerFull.spike') };
  const layerColors: Record<string, string> = { trend: 'border-blue-500', swing: 'border-emerald-500', spike: 'border-orange-500' };
  const layerDescriptions: Record<string, string> = {
    trend: t('strategy.layerDesc.trend'),
    swing: t('strategy.layerDesc.swing'),
    spike: t('strategy.layerDesc.spike'),
  };
  const [expandedLayerInfo, setExpandedLayerInfo] = useState<string | null>(null);

  return (
    <div className={`fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 ${isMobile ? 'p-0' : 'p-4'}`}>
      <div className={`w-full ${isMobile ? 'h-full rounded-none' : 'max-w-3xl max-h-[90vh] rounded-2xl'} overflow-y-auto`} style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.97) 0%, rgba(10,15,30,0.95) 100%)', border: isMobile ? 'none' : '1px solid rgba(51,65,85,0.4)', boxShadow: isMobile ? 'none' : '0 24px 80px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03) inset' }}>
        {/* Header */}
        <div className={`flex items-center justify-between ${isMobile ? 'px-4 py-3' : 'p-6'} sticky top-0 z-10`} style={{ borderBottom: '1px solid rgba(51,65,85,0.3)', background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(10,15,30,0.96) 100%)', backdropFilter: 'blur(12px)' }}>
          <div>
            <h2 className={`${isMobile ? 'text-base' : 'text-xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>{t('creator.title')}</h2>
            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-0.5 font-medium`}>{t('creator.step', { current: step, total: 5 })}</p>
          </div>
          <button onClick={onCancel} className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-all">
            <X className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
          </button>
        </div>

        {/* Account Assets - 步骤2及以后始终显示 */}
        {step >= 2 && connectionOk && localBalances.length > 0 && (
          <div className={`${isMobile ? 'px-3 pt-3' : 'px-6 pt-4'}`}>
            <div className={`rounded-xl ${isMobile ? 'p-3' : 'p-4'}`} style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(59,130,246,0.12)' }}>
              <div className={`flex items-center justify-between ${isMobile ? 'mb-2' : 'mb-3'}`}>
                <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-400 flex items-center gap-1.5`}>
                  <Wallet className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
                  {selectedAccount && getExchangeConfig(selectedAccount.exchange || 'binance').logo} {isMobile ? '' : selectedAccount?.label} {t('creator.assets')}
                </span>
                <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold text-blue-400`}>
                  ${localTotalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {localBalances.slice(0, isMobile ? 6 : 12).map((b) => (
                  <div
                    key={b.asset}
                    className={`flex items-center gap-1.5 ${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded-lg bg-slate-900/60`}
                  >
                    <span className="font-medium text-slate-200">{b.asset}</span>
                    <span className="text-slate-500">{parseFloat(b.free).toFixed(b.asset === 'USDT' || b.asset === 'USDC' ? 2 : isMobile ? 4 : 6)}</span>
                    {b.usdtValue > 0.01 && !isMobile && (
                      <span className="text-slate-600">≈${b.usdtValue.toFixed(2)}</span>
                    )}
                  </div>
                ))}
                {localBalances.length > (isMobile ? 6 : 12) && (
                  <div className={`flex items-center ${isMobile ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded-lg bg-slate-900/60 text-slate-500`}>
                    {t('creator.moreAssets', { count: localBalances.length - (isMobile ? 6 : 12) })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Progress */}
        <div className={`flex ${isMobile ? 'px-4 pt-3' : 'px-6 pt-4'} gap-1.5`}>
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className="h-1 flex-1 rounded-full transition-all duration-300"
              style={s <= step ? { background: 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)', boxShadow: '0 0 8px rgba(99,102,241,0.3)' } : { background: 'rgba(30,41,59,0.6)' }}
            />
          ))}
        </div>

        <div className={`${isMobile ? 'p-4 space-y-4' : 'p-6 space-y-6'}`}>
          {/* Step 1: Select Exchange Account */}
          {step === 1 && (
            <>
              <div>
                <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.selectAccount')}</label>
                <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-3`}>
                  {isMobile ? t('creator.selectAccountDescMobile') : t('creator.selectAccountDesc')}
                </p>
                {(!savedConfigs || savedConfigs.length === 0) ? (
                  <div className={`${isMobile ? 'p-4' : 'p-6'} rounded-xl border border-dashed border-slate-700 text-center space-y-2`}>
                    <p className={`text-slate-500 ${isMobile ? 'text-sm' : ''}`}>{t('creator.noAccountConfigured')}</p>
                    <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>{t('creator.goToAccountManager')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedConfigs.map((config) => {
                      const cfg = getExchangeConfig(config.exchange || 'binance');
                      const isSelected = selectedAccount?.id === config.id;
                      return (
                        <button
                          key={config.id}
                          className={`w-full flex items-center justify-between ${isMobile ? 'p-3' : 'p-4'} rounded-xl border text-left transition-all duration-200 ${
                            isSelected
                              ? 'border-blue-500 bg-blue-600/10 ring-1 ring-blue-500/30'
                              : 'border-slate-800 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50'
                          }`}
                          onClick={() => handleSelectAccount(config)}
                        >
                          <div className="flex items-center gap-2">
                            <span className={isMobile ? 'text-xl' : 'text-2xl'}>{cfg.logo}</span>
                            <div className="min-w-0">
                              <p className={`${isMobile ? 'text-sm' : ''} font-medium flex items-center gap-1.5`}>
                                <span className="truncate">{config.label}</span>
                                <span className={`${isMobile ? 'text-xs px-1' : 'text-sm px-1.5'} py-0.5 rounded bg-slate-700/50 text-slate-400 shrink-0`}>
                                  {cfg.name.split(' ')[0]}
                                </span>
                              </p>
                              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-0.5`}>
                                {config.apiKey.slice(0, 6)}...{config.apiKey.slice(-4)}
                                {!isMobile && <span className="ml-3">{new Date(config.createdAt).toLocaleDateString()}</span>}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isSelected && (
                              <span className={`${isMobile ? 'text-xs px-1.5' : 'text-sm px-2'} py-0.5 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30`}>{t('common.selected')}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {selectedAccount && (
                <div className={`${isMobile ? 'p-3' : 'p-4'} rounded-xl border ${
                  checking ? 'bg-blue-600/5 border-blue-500/20' :
                  connectionOk ? 'bg-emerald-600/5 border-emerald-500/20' :
                  connectionError ? 'bg-red-600/5 border-red-500/20' :
                  'bg-slate-800/30 border-slate-700/50'
                }`}>
                  {checking ? (
                    <div className={`flex items-center gap-2 ${isMobile ? 'text-xs' : 'text-sm'} text-blue-400`}>
                      <Loader2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} animate-spin`} />
                      {t('connection.verifyingApi')}
                    </div>
                  ) : connectionOk ? (
                    <div className={isMobile ? 'space-y-2' : 'space-y-3'}>
                      <div className="flex items-center justify-between">
                        <div className={`flex items-center gap-2 ${isMobile ? 'text-xs' : 'text-sm'} text-emerald-400`}>
                          <CheckCircle className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                          <span className="font-medium">
                            {getExchangeConfig(selectedAccount.exchange || 'binance').logo} {isMobile ? t('connection.connectionSuccess') : `${selectedAccount.label} ${t('connection.connectionSuccess')}`}
                          </span>
                        </div>
                        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold text-blue-400`}>
                          ${localTotalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      {localBalances.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {localBalances.slice(0, isMobile ? 6 : 10).map((b) => (
                            <div key={b.asset} className={`flex items-center gap-1.5 ${isMobile ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'} rounded-lg bg-slate-900/60`}>
                              <span className="font-medium text-slate-200">{b.asset}</span>
                              <span className="text-slate-500">{parseFloat(b.free).toFixed(b.asset === 'USDT' || b.asset === 'USDC' ? 2 : isMobile ? 4 : 6)}</span>
                              {b.usdtValue > 0.01 && !isMobile && <span className="text-slate-600">≈${b.usdtValue.toFixed(2)}</span>}
                            </div>
                          ))}
                          {localBalances.length > (isMobile ? 6 : 10) && (
                            <span className={`flex items-center ${isMobile ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'} rounded-lg bg-slate-900/60 text-slate-500`}>{t('creator.moreAssets', { count: localBalances.length - (isMobile ? 6 : 10) })}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : connectionError ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        <span className="font-medium">{t('connection.connectionFailed')}</span>
                      </div>
                      <p className="text-sm text-red-400/80">{connectionError}</p>
                      <button
                        className="text-sm text-blue-400 hover:text-blue-300"
                        onClick={() => handleCheckConnection(selectedAccount)}
                      >
                        {t('connection.retryConnection')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span>{t('connection.autoDetect')}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Step 2: Select Symbol & Fund */}
          {step === 2 && (
            <>
              <div ref={dropdownRef}>
                <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.tradingPair')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    ref={inputRef}
                    className={`input-field pl-10 pr-16 ${symbol ? 'text-transparent' : ''}`}
                    placeholder={symbol ? '' : t('creator.searchPlaceholder')}
                    value={symbol ? '' : symbolSearch}
                    onChange={(e) => { setSymbolSearch(e.target.value); setShowDropdown(true); }}
                    onFocus={() => { if (symbol) { handleClearSymbol(); } setShowDropdown(true); }}
                  />
                  {symbol && (
                    <div className="absolute inset-y-0 left-10 flex items-center pointer-events-none">
                      <span className="font-medium text-blue-400">{symbol.replace('USDT', '')}</span>
                      <span className="text-slate-500">/USDT</span>
                    </div>
                  )}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {symbol && (
                      <button
                        className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
                        onClick={(e) => { e.stopPropagation(); handleClearSymbol(); setShowDropdown(true); }}
                        title={t('common.delete')}
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
                      onClick={() => { setShowDropdown(!showDropdown); if (!showDropdown) inputRef.current?.focus(); }}
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
                {showDropdown && (
                  <div className="mt-1 rounded-xl max-h-60 overflow-y-auto" style={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(51,65,85,0.4)', boxShadow: '0 12px 40px -8px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }}>
                    {!symbolSearch.trim() && !symbol && (
                      <div className="px-3 py-1.5 text-sm text-slate-500 border-b border-slate-700">{t('creator.popularPairs')}</div>
                    )}
                    {filteredSymbols.length > 0 ? filteredSymbols.map((s) => (
                      <button
                        key={s.symbol}
                        className={`w-full text-left px-3 py-2.5 hover:bg-slate-700 text-sm flex items-center justify-between transition-colors ${
                          symbol === s.symbol ? 'bg-blue-600/10 text-blue-400' : ''
                        }`}
                        onClick={() => { selectSymbol(s.symbol); setShowDropdown(false); }}
                      >
                        <div>
                          <span className="font-medium">{s.baseAsset}</span>
                          <span className="text-slate-500">/USDT</span>
                        </div>
                        {symbol === s.symbol && <span className="text-sm text-blue-400">{t('common.selected')}</span>}
                      </button>
                    )) : (
                      <div className="px-3 py-4 text-sm text-slate-500 text-center">{t('creator.noMatchPairs')}</div>
                    )}
                  </div>
                )}
                {symbol && currentPrice > 0 && (
                  <div className={`mt-2 flex ${isMobile ? 'flex-col gap-1' : 'items-center gap-4'} ${isMobile ? 'text-xs' : 'text-sm'}`}>
                    <span className="text-slate-400">{t('creator.currentPrice')}: <span className="text-white font-mono">${currentPrice.toLocaleString()}</span></span>
                    <span className="text-slate-400">
                      {t('creator.volatility')}: <span className={volatility.percent < 2 ? 'text-emerald-400' : volatility.percent < 5 ? 'text-yellow-400' : 'text-red-400'}>
                        {volatility.percent < 2 ? t('creator.volatilityLow') : volatility.percent < 5 ? t('creator.volatilityMid') : t('creator.volatilityHigh')} ({volatility.percent.toFixed(2)}%)
                      </span>
                    </span>
                  </div>
                )}
              </div>

              <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
                <div>
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-1.5`}>{t('creator.strategyName')}</label>
                  <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('creator.strategyNamePlaceholder')} />
                </div>
                <div>
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-1.5`}>{t('creator.investmentFund')}</label>
                  <input className="input-field" type="number" value={totalFund} onChange={(e) => setTotalFund(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          {/* Step 3: Range Settings */}
          {step === 3 && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300`}>{t('creator.entryPrice')}</label>
                  <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{isMobile ? t('creator.entryPriceTrigger') : t('creator.entryPriceTriggerFull')}</span>
                </div>
                <input
                  className="input-field"
                  type="number"
                  step="0.01"
                  placeholder={t('creator.entryPricePlaceholder')}
                  value={entryPrice || ''}
                  onChange={(e) => setEntryPrice(Number(e.target.value))}
                />
                {currentPrice > 0 && entryPrice !== currentPrice && (
                  <p className="text-sm text-slate-500 mt-1">
                    {t('creator.currentMarketPrice')}: <span className="text-slate-400 font-mono">${currentPrice.toLocaleString()}</span>
                    <button
                      className="ml-2 text-blue-400 hover:text-blue-300"
                      onClick={() => setEntryPrice(currentPrice)}
                    >
                      {t('creator.resetToMarketPrice')}
                    </button>
                  </p>
                )}
              </div>

              <div>
                <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.rangeMode')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {([['fixed', t('creator.rangeModeFixed')], ['percentage', t('creator.rangeModePercentage')]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      className={`p-3 rounded-lg border text-sm transition-colors ${
                        rangeMode === key ? 'border-blue-500 bg-blue-600/10 text-blue-400' : 'border-slate-700 hover:border-slate-600'
                      }`}
                      onClick={() => { setRangeMode(key); setUpperPrice(0); setLowerPrice(0); updateLayerPrices(0, 0); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300`}>{t('creator.priceRange')}</label>
                  {upperPrice > 0 && lowerPrice > 0 ? (
                    <button
                      className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
                      onClick={() => {
                        setUpperPrice(0);
                        setLowerPrice(0);
                        updateLayerPrices(0, 0);
                      }}
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      {t('creator.clearAll')}
                    </button>
                  ) : (
                    <button
                      className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      onClick={() => {
                        if (entryPrice <= 0) return;
                        if (rangeMode === 'percentage') {
                          setUpperPrice(30);
                          setLowerPrice(-30);
                          updateLayerPrices(-30, 30);
                        } else {
                          const up = +(entryPrice * 1.3).toFixed(2);
                          const low = +(entryPrice * 0.7).toFixed(2);
                          setUpperPrice(up);
                          setLowerPrice(low);
                          updateLayerPrices(low, up);
                        }
                      }}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      {t('creator.autoFill')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <input
                      className={`input-field ${rangeMode === 'percentage' ? 'pr-8' : ''}`}
                      type="number"
                      step="0.01"
                      placeholder={t('creator.highest')}
                      value={upperPrice || ''}
                      onChange={(e) => { const v = Number(e.target.value); setUpperPrice(v); updateLayerPrices(lowerPrice, v); }}
                    />
                    {rangeMode === 'percentage' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">%</span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      className={`input-field ${rangeMode === 'percentage' ? 'pr-8' : ''}`}
                      type="number"
                      step="0.01"
                      placeholder={t('creator.lowest')}
                      value={lowerPrice || ''}
                      onChange={(e) => { const v = Number(e.target.value); setLowerPrice(v); updateLayerPrices(v, upperPrice); }}
                    />
                    {rangeMode === 'percentage' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">%</span>
                    )}
                  </div>
                </div>
              </div>

              {upperPrice > 0 && lowerPrice > 0 && (
                <div className={`${isMobile ? 'p-2' : 'p-3'} rounded-lg bg-slate-800/50 ${isMobile ? 'text-xs' : 'text-sm'}`}>
                  <p className="text-slate-400">
                    {t('creator.rangeWidth')}: <span className="text-white">{((upperPrice - lowerPrice) / currentPrice * 100).toFixed(1)}%</span>
                    <span className="mx-2">|</span>
                    {t('creator.midPrice')}: <span className="text-white">${((upperPrice + lowerPrice) / 2).toFixed(2)}</span>
                  </p>
                </div>
              )}
            </>
          )}

          {/* Step 4: Grid Layers */}
          {step === 4 && (
            <>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{isMobile ? t('creator.configLayers') : t('creator.configLayersFull')}</p>
              {layers.map((layer, i) => (
                <div key={layer.layer} className={`rounded-xl border-l-4 ${layerColors[layer.layer]} transition-all duration-200 ${layer.enabled ? (isMobile ? 'p-3 space-y-2.5' : 'p-4 space-y-3') : (isMobile ? 'px-3 py-2.5' : 'px-4 py-3')}`} style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.6) 0%, rgba(30,41,59,0.3) 100%)', boxShadow: '0 2px 8px -2px rgba(0,0,0,0.15)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={layer.enabled} onChange={(e) => updateLayer(i, { enabled: e.target.checked })} className="rounded" />
                        <span className={`${isMobile ? 'text-sm' : ''} font-medium ${layer.enabled ? '' : 'text-slate-500'}`}>{layerNames[layer.layer]}</span>
                      </label>
                      {layer.enabled && (
                        <button
                          className="p-0.5 text-slate-500 hover:text-blue-400 transition-colors"
                          onClick={() => setExpandedLayerInfo(expandedLayerInfo === layer.layer ? null : layer.layer)}
                          title={t('creator.viewDescription')}
                        >
                          <HelpCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {layer.enabled ? (
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.fund')} {Math.round(layer.fundRatio * 100)}%</span>
                    ) : (
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>{isMobile ? t('creator.notEnabled') : t('creator.notEnabledFull')}</span>
                    )}
                  </div>

                  {layer.enabled && expandedLayerInfo === layer.layer && (
                    <div className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-3 py-2.5 text-sm'} rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-400 leading-relaxed`}>
                      {layerDescriptions[layer.layer]}
                    </div>
                  )}

                  {layer.enabled && (
                    <div className="space-y-3">
                      {/* Row 1: Grid count, fund ratio */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.gridCountLabel')}</label>
                          <input className="input-field text-sm mt-1" type="number" value={layer.gridCount} onChange={(e) => updateLayer(i, { gridCount: Number(e.target.value) })} />
                        </div>
                        <div className="relative">
                          <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.fundRatio')}</label>
                          <input
                            className="input-field text-sm mt-1 pr-8"
                            type="number"
                            step="5"
                            min="0"
                            max="100"
                            value={Math.round(layer.fundRatio * 100)}
                            onChange={(e) => {
                              const pct = Math.min(100, Math.max(0, Number(e.target.value)));
                              updateLayer(i, { fundRatio: pct / 100 });
                            }}
                          />
                          <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                        </div>
                      </div>

                      {/* Row 2: Layer price range with ratio */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.layerPriceRange')}</label>
                          <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>
                            {entryPrice > 0 && upperPrice > 0 && lowerPrice > 0
                              ? t('creator.basedOnEntryRange', { ratio: Math.round(layer.rangeRatio * 100) })
                              : t('creator.setEntryRangeFirst')}
                          </span>
                        </div>
                        {/* Range ratio slider */}
                        <div className="flex items-center gap-2 mb-2">
                          <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 whitespace-nowrap`}>{t('creator.rangeRatio')}</label>
                          <input
                            type="range"
                            className="flex-1 h-1.5 accent-blue-500"
                            min="10"
                            max="200"
                            step="5"
                            value={Math.round(layer.rangeRatio * 100)}
                            onChange={(e) => {
                              const ratio = Number(e.target.value) / 100;
                              if (entryPrice > 0 && upperPrice > 0 && lowerPrice > 0) {
                                const halfRange = (upperPrice - lowerPrice) / 2 * ratio;
                                const center = entryPrice;
                                updateLayer(i, {
                                  rangeRatio: ratio,
                                  upperPrice: +(center + halfRange).toFixed(2),
                                  lowerPrice: +(center - halfRange).toFixed(2),
                                });
                              } else {
                                updateLayer(i, { rangeRatio: ratio });
                              }
                            }}
                          />
                          <div className="relative w-20">
                            <input
                              className="input-field text-sm pr-7 text-center"
                              type="number"
                              step="5"
                              min="10"
                              max="200"
                              value={Math.round(layer.rangeRatio * 100)}
                              onChange={(e) => {
                                const ratio = Math.min(200, Math.max(10, Number(e.target.value))) / 100;
                                if (entryPrice > 0 && upperPrice > 0 && lowerPrice > 0) {
                                  const halfRange = (upperPrice - lowerPrice) / 2 * ratio;
                                  const center = entryPrice;
                                  updateLayer(i, {
                                    rangeRatio: ratio,
                                    upperPrice: +(center + halfRange).toFixed(2),
                                    lowerPrice: +(center - halfRange).toFixed(2),
                                  });
                                } else {
                                  updateLayer(i, { rangeRatio: ratio });
                                }
                              }}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">%</span>
                          </div>
                        </div>
                        {/* Computed price display */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 mb-0.5 block`}>{t('creator.upperBound')}</label>
                            <input
                              className="input-field text-sm"
                              type="number"
                              step="0.01"
                              placeholder={t('creator.upperBound')}
                              value={layer.upperPrice || ''}
                              onChange={(e) => updateLayer(i, { upperPrice: Number(e.target.value) })}
                            />
                          </div>
                          <div>
                            <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 mb-0.5 block`}>{t('creator.lowerBound')}</label>
                            <input
                              className="input-field text-sm"
                              type="number"
                              step="0.01"
                              placeholder={t('creator.lowerBound')}
                              value={layer.lowerPrice || ''}
                              onChange={(e) => updateLayer(i, { lowerPrice: Number(e.target.value) })}
                            />
                          </div>
                        </div>
                        {layer.upperPrice > 0 && layer.lowerPrice > 0 && layer.gridCount > 0 && (
                          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 mt-1`}>
                            {t('creator.perGrid')} ≈ ${((layer.upperPrice - layer.lowerPrice) / layer.gridCount).toFixed(4)}
                            <span className="mx-2">|</span>
                            {t('creator.width')} {((layer.upperPrice - layer.lowerPrice) / entryPrice * 100).toFixed(1)}%
                          </p>
                        )}
                      </div>

                      {/* Row 3: Profit mode selector */}
                      <div>
                        <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 block mb-1`}>{t('creator.profitMode')}</label>
                        <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'} gap-1.5`}>
                          {([
                            ['fixed_rate', t('creator.profitModeFixed')],
                            ['per_grid', t('creator.profitModePerGrid')],
                            ['distance_increase', t('creator.profitModeDistance')],
                            ['trend_increase', t('creator.profitModeTrend')],
                          ] as const).map(([key, label]) => (
                            <button
                              key={key}
                              className={`px-2 py-1.5 rounded-lg text-sm transition-colors border ${
                                layer.profitMode === key
                                  ? 'border-blue-500 bg-blue-600/10 text-blue-400'
                                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
                              }`}
                              onClick={() => updateLayer(i, { profitMode: key })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Row 4: Profit mode specific config */}
                      <div className={`rounded-lg bg-slate-900/40 border border-slate-700/30 ${isMobile ? 'p-2.5' : 'p-3'}`}>
                        {layer.profitMode === 'fixed_rate' && (() => {
                          const autoRate = (layer.upperPrice > 0 && layer.lowerPrice > 0 && layer.gridCount > 0)
                            ? +((layer.upperPrice - layer.lowerPrice) / layer.gridCount / ((layer.upperPrice + layer.lowerPrice) / 2) * 100).toFixed(2)
                            : 0;
                          return (
                            <div>
                              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-2`}>{isMobile ? t('creator.fixedRateDescMobile') : t('creator.fixedRateDesc')}</p>
                              <div className={`relative ${isMobile ? 'w-full' : 'w-48'}`}>
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.autoRate')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8 bg-slate-800/60 text-slate-300 cursor-not-allowed"
                                  type="text"
                                  readOnly
                                  value={autoRate > 0 ? autoRate : t('creator.setPriceRangeFirst')}
                                />
                                {autoRate > 0 && <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>}
                              </div>
                            </div>
                          );
                        })()}

                        {layer.profitMode === 'per_grid' && (
                          <div>
                            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-2`}>{isMobile ? t('creator.perGridDescMobile') : t('creator.perGridDesc')}</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.minRate')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="0.1"
                                  value={layer.perGridMinRate}
                                  onChange={(e) => updateLayer(i, { perGridMinRate: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.maxRate')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="0.1"
                                  value={layer.perGridMaxRate}
                                  onChange={(e) => updateLayer(i, { perGridMaxRate: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {layer.profitMode === 'distance_increase' && (
                          <div>
                            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-2`}>{isMobile ? t('creator.distanceDescMobile') : t('creator.distanceDesc')}</p>
                            <div className={`grid ${isMobile ? 'grid-cols-3' : 'grid-cols-3'} gap-2`}>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.baseRate')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="0.1"
                                  value={layer.distBaseRate}
                                  onChange={(e) => updateLayer(i, { distBaseRate: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.incrementPerGrid')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="0.1"
                                  value={layer.distIncreaseStep}
                                  onChange={(e) => updateLayer(i, { distIncreaseStep: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.maxCap')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="0.1"
                                  value={layer.distMaxRate}
                                  onChange={(e) => updateLayer(i, { distMaxRate: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {layer.profitMode === 'trend_increase' && (
                          <div>
                            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mb-2`}>{isMobile ? t('creator.trendDescMobile') : t('creator.trendDesc')}</p>
                            <div className={`grid grid-cols-3 gap-2`}>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.baseRate')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="0.1"
                                  value={layer.trendBaseRate}
                                  onChange={(e) => updateLayer(i, { trendBaseRate: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{isMobile ? t('creator.bullRatioMobile') : t('creator.bullRatio')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="5"
                                  value={Math.round(layer.trendBullMultiplier * 100)}
                                  onChange={(e) => updateLayer(i, { trendBullMultiplier: Number(e.target.value) / 100 })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{isMobile ? t('creator.bearRatioMobile') : t('creator.bearRatio')}</label>
                                <input
                                  className="input-field text-sm mt-1 pr-8"
                                  type="number"
                                  step="5"
                                  value={Math.round(layer.trendBearMultiplier * 100)}
                                  onChange={(e) => updateLayer(i, { trendBearMultiplier: Number(e.target.value) / 100 })}
                                />
                                <span className="absolute right-3 bottom-2.5 text-slate-500 text-sm pointer-events-none">%</span>
                              </div>
                            </div>
                            <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 mt-2`}>
                              {t('creator.example')}：{layer.trendBaseRate}%×{Math.round(layer.trendBullMultiplier * 100)}%={(layer.trendBaseRate * layer.trendBullMultiplier).toFixed(1)}%，
                              {layer.trendBaseRate}%×{Math.round(layer.trendBearMultiplier * 100)}%={(layer.trendBaseRate * layer.trendBearMultiplier).toFixed(1)}%
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Step 5: Profit & Risk */}
          {step === 5 && (
            <>
              <div>
                <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.profitAllocation')}</label>
                <select className="select-field" value={profitAllocation} onChange={(e) => setProfitAllocation(e.target.value as ProfitAllocation)}>
                  <option value="all_usdt">{t('creator.allUsdt')}</option>
                  <option value="all_coin">{t('creator.allCoin')}</option>
                  <option value="ratio">{t('creator.ratioSplit')}</option>
                  <option value="reinvest">{t('creator.reinvest')}</option>
                  <option value="threshold_switch">{t('creator.thresholdSwitch')}</option>
                </select>
              </div>

              {profitAllocation === 'reinvest' && (
                <div className={isMobile ? 'space-y-2' : 'space-y-3'}>
                  <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('creator.reinvestDesc')}</p>
                  <div className={`grid ${isMobile ? 'grid-cols-1 gap-2' : 'grid-cols-2 gap-3'}`}>
                    <button
                      className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-lg border ${isMobile ? 'text-xs' : 'text-sm'} text-left transition-colors ${
                        reinvestMode === 'per_grid'
                          ? 'border-blue-500 bg-blue-600/10 text-blue-400'
                          : 'border-slate-700 hover:border-slate-600 text-slate-400'
                      }`}
                      onClick={() => setReinvestMode('per_grid')}
                    >
                      <span className="font-medium block">{t('creator.reinvestPerGrid')}</span>
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-1 block`}>{isMobile ? t('creator.reinvestPerGridDescMobile') : t('creator.reinvestPerGridDesc')}</span>
                    </button>
                    <button
                      className={`${isMobile ? 'p-2.5' : 'p-3'} rounded-lg border ${isMobile ? 'text-xs' : 'text-sm'} text-left transition-colors ${
                        reinvestMode === 'whole_strategy'
                          ? 'border-blue-500 bg-blue-600/10 text-blue-400'
                          : 'border-slate-700 hover:border-slate-600 text-slate-400'
                      }`}
                      onClick={() => setReinvestMode('whole_strategy')}
                    >
                      <span className="font-medium block">{t('creator.reinvestWholeStrategy')}</span>
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-1 block`}>{isMobile ? t('creator.reinvestWholeStrategyDescMobile') : t('creator.reinvestWholeStrategyDesc')}</span>
                    </button>
                  </div>
                </div>
              )}

              {profitAllocation === 'threshold_switch' && (
                <div className={isMobile ? 'space-y-2' : 'space-y-3'}>
                  <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>
                    {isMobile ? t('creator.thresholdDescMobile') : t('creator.thresholdDesc')}
                  </p>
                  <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
                    <div>
                      <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 block mb-1`}>{isMobile ? t('creator.holdCoinPriceMobile') : t('creator.holdCoinPrice')}</label>
                      <input
                        className="input-field text-sm"
                        type="number"
                        step="0.01"
                        placeholder={entryPrice > 0 ? `${(entryPrice * 0.75).toFixed(2)}` : t('creator.entryPricePlaceholder')}
                        value={thresholdHoldCoinPrice || ''}
                        onChange={(e) => setThresholdHoldCoinPrice(Number(e.target.value))}
                      />
                      {entryPrice > 0 && (
                        <p className="text-sm text-slate-600 mt-1">{t('creator.defaultEntryMinus')} = {(entryPrice * 0.75).toFixed(2)}</p>
                      )}
                    </div>
                    <div>
                      <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 block mb-1`}>{isMobile ? t('creator.holdUsdtPriceMobile') : t('creator.holdUsdtPrice')}</label>
                      <input
                        className="input-field text-sm"
                        type="number"
                        step="0.01"
                        placeholder={entryPrice > 0 ? `${(entryPrice * 1.25).toFixed(2)}` : t('creator.entryPricePlaceholder')}
                        value={thresholdHoldUsdtPrice || ''}
                        onChange={(e) => setThresholdHoldUsdtPrice(Number(e.target.value))}
                      />
                      {entryPrice > 0 && (
                        <p className="text-sm text-slate-600 mt-1">{t('creator.defaultEntryPlus')} = {(entryPrice * 1.25).toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                  {entryPrice > 0 && !thresholdHoldCoinPrice && !thresholdHoldUsdtPrice && (
                    <button
                      className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      onClick={() => {
                        setThresholdHoldCoinPrice(+(entryPrice * 0.75).toFixed(2));
                        setThresholdHoldUsdtPrice(+(entryPrice * 1.25).toFixed(2));
                      }}
                    >
                      {t('creator.fillDefault')}
                    </button>
                  )}
                </div>
              )}

              {profitAllocation === 'ratio' && (
                <div>
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.usdtRatio')}: {profitRatio}%</label>
                  <input type="range" className="w-full" min="0" max="100" value={profitRatio} onChange={(e) => setProfitRatio(Number(e.target.value))} />
                  <div className="flex justify-between text-sm text-slate-500 mt-1">
                    <span>{t('creator.allCoinLabel')}</span>
                    <span>{t('creator.allUsdtLabel')}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.rangeBreakout')}</label>
                  <label className={`flex items-center gap-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>
                    <input type="checkbox" checked={autoRebalance} onChange={(e) => setAutoRebalance(e.target.checked)} className="rounded" />
                    {t('creator.autoRebalance')}
                  </label>
                </div>
                <div>
                  <label className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-slate-300 block mb-2`}>{t('creator.endMode')}</label>
                  <select className="select-field" value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)}>
                    <option value="hold_coin">{t('creator.endModeHoldCoin')}</option>
                    <option value="hold_usdt">{t('creator.endModeHoldUsdt')}</option>
                    <option value="keep_position">{t('creator.endModeKeepPosition')}</option>
                    <option value="force_close">{t('creator.endModeForceClose')}</option>
                  </select>
                </div>
              </div>

              {/* Summary */}
              <div className={`${isMobile ? 'p-3' : 'p-4'} rounded-xl space-y-2`} style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(99,102,241,0.05) 100%)', border: '1px solid rgba(59,130,246,0.2)', boxShadow: '0 0 20px -4px rgba(59,130,246,0.1)' }}>
                <h4 className={`${isMobile ? 'text-sm' : ''} font-medium text-blue-400`}>{t('creator.summary')}</h4>
                <div className={`grid grid-cols-2 gap-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>
                  <p className="text-slate-400">{t('creator.summaryPair')}: <span className="text-white">{symbol}</span></p>
                  <p className="text-slate-400">{t('creator.summaryFund')}: <span className="text-white">{totalFund} USDT</span></p>
                  <p className="text-slate-400">{t('creator.summaryRange')}: <span className="text-white">{lowerPrice.toFixed(2)} - {upperPrice.toFixed(2)}</span></p>
                  <p className="text-slate-400">{t('creator.summaryGridTotal')}: <span className="text-white">{layers.filter((l) => l.enabled).reduce((a, l) => a + l.gridCount, 0)}</span></p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between ${isMobile ? 'px-4 py-3' : 'p-6'} sticky bottom-0`} style={{ borderTop: '1px solid rgba(51,65,85,0.3)', background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(10,15,30,0.96) 100%)', backdropFilter: 'blur(12px)' }}>
          <button
            className="btn-secondary"
            onClick={() => step > 1 ? setStep(step - 1) : onCancel()}
          >
            {step > 1 ? t('common.previous') : t('common.cancel')}
          </button>
          {step < 5 ? (
            <button
              className="btn-primary"
              onClick={() => setStep(step + 1)}
              disabled={
                (step === 1 && (!selectedAccount || !connectionOk || checking)) ||
                (step === 2 && (!symbol || !name || totalFund <= 0))
              }
            >
              {t('common.next')}
            </button>
          ) : (
            <button className="btn-success" onClick={handleCreate}>
              {t('creator.createStrategy')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
