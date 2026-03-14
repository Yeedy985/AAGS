import { useState, useEffect, useCallback } from 'react';
import { Key, Eye, EyeOff, RefreshCw, Trash2, CheckCircle, AlertCircle, ExternalLink, Loader2, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { db } from '../db';
import { encrypt } from '../services/crypto';
import { getAccountInfo, getTicker24h, setCurrentExchange } from '../services/binance';
import { getExchangeList, needsPassphrase, getExchangeConfig } from '../services/exchangeConfig';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ApiConfig, ExchangeType, AssetBalance } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTranslation } from 'react-i18next';

interface AccountBalanceInfo {
  balances: AssetBalance[];
  totalUsdt: number;
  loading: boolean;
  error: string;
}

export default function AccountManager() {
  const { apiConfig, setApiConfig, accountInfo, setAccountInfo, setIsConnected, refreshIntervals } = useStore();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [selectedExchange, setSelectedExchange] = useState<ExchangeType>('binance');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [label, setLabel] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 每个账户的资产数据
  const [accountBalances, setAccountBalances] = useState<Record<number, AccountBalanceInfo>>({});
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set());

  // 最小显示价值阈值（用户可配置，保存到 localStorage）
  const [minDisplayValue, setMinDisplayValue] = useState<number>(() => {
    const saved = localStorage.getItem('aags_min_display_value');
    return saved ? Number(saved) : 1;
  });
  const handleMinValueChange = (val: number) => {
    setMinDisplayValue(val);
    localStorage.setItem('aags_min_display_value', String(val));
  };

  const savedConfigs = useLiveQuery(() => db.apiConfigs.toArray(), []);

  useEffect(() => {
    if (savedConfigs && savedConfigs.length > 0 && !apiConfig) {
      const first = savedConfigs[0];
      setApiConfig(first);
      setCurrentExchange(first.exchange || 'binance');
    }
  }, [savedConfigs, apiConfig, setApiConfig]);

  // 加载单个账户资产（批量获取价格，大幅提速）
  const fetchAccountBalances = useCallback(async (config: ApiConfig) => {
    if (!config.id) return;
    setAccountBalances(prev => ({
      ...prev,
      [config.id!]: { balances: prev[config.id!]?.balances || [], totalUsdt: prev[config.id!]?.totalUsdt || 0, loading: true, error: '' },
    }));
    try {
      setCurrentExchange(config.exchange || 'binance');
      const data = await getAccountInfo(config.apiKey, config.apiSecret);
      const cfg = getExchangeConfig(config.exchange || 'binance');

      // 先过滤掉余额极小的资产（free+locked 几乎为 0），减少后续处理
      const significantBalances = data.balances.filter(b => {
        const qty = parseFloat(b.free) + parseFloat(b.locked);
        return qty > 1e-8;
      });

      // 批量获取所有 USDT 交易对价格（1次API调用替代N次）
      const tickers = await getTicker24h();
      const priceMap = new Map<string, number>();
      for (const t of tickers) {
        if (t.symbol.endsWith('USDT')) {
          priceMap.set(t.symbol, parseFloat(t.price));
        }
      }

      let total = 0;
      for (const balance of significantBalances) {
        if (cfg.quoteAssets.includes(balance.asset)) {
          balance.usdtValue = parseFloat(balance.free) + parseFloat(balance.locked);
        } else {
          const price = priceMap.get(`${balance.asset}USDT`) || 0;
          balance.usdtValue = (parseFloat(balance.free) + parseFloat(balance.locked)) * price;
        }
        total += balance.usdtValue;
      }
      setAccountBalances(prev => ({
        ...prev,
        [config.id!]: {
          balances: significantBalances.sort((a, b) => b.usdtValue - a.usdtValue),
          totalUsdt: total,
          loading: false,
          error: '',
        },
      }));
    } catch (err: any) {
      setAccountBalances(prev => ({
        ...prev,
        [config.id!]: { balances: [], totalUsdt: 0, loading: false, error: err.message || t('common.failed') },
      }));
    }
  }, []);

  // 所有账户加载后自动查询资产
  useEffect(() => {
    if (savedConfigs && savedConfigs.length > 0) {
      for (const config of savedConfigs) {
        if (config.id && !accountBalances[config.id]) {
          fetchAccountBalances(config);
        }
      }
    }
  }, [savedConfigs, accountBalances, fetchAccountBalances]);

  const toggleExpanded = (id: number) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exchangeConfig = getExchangeConfig(selectedExchange);
  const requiresPassphrase = needsPassphrase(selectedExchange);

  const handleSave = async () => {
    if (!apiKey || !apiSecret) {
      setError(t('account.fillApiKeyAndSecret'));
      return;
    }
    if (requiresPassphrase && !passphrase) {
      setError(t('account.passphraseRequired', { name: exchangeConfig.name }));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const trimmedKey = apiKey.trim();
      const trimmedSecret = apiSecret.trim();
      const encryptedSecret = encrypt(trimmedSecret);
      const config: ApiConfig = {
        exchange: selectedExchange,
        apiKey: trimmedKey,
        apiSecret: encryptedSecret,
        passphrase: requiresPassphrase ? encrypt(passphrase.trim()) : undefined,
        label: label || `${exchangeConfig.name} ${t('account.defaultLabel')}`,
        createdAt: Date.now(),
      };
      const id = await db.apiConfigs.add(config);
      config.id = id;
      setApiConfig(config);
      setCurrentExchange(selectedExchange);
      setSuccess(t('account.saveSuccess', { name: exchangeConfig.name }));
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      setLabel('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleDelete = async (id: number) => {
    await db.apiConfigs.delete(id);
    if (apiConfig?.id === id) {
      setApiConfig(null);
      setAccountInfo(null);
      setIsConnected(false);
    }
  };

  const handleSelect = (config: ApiConfig) => {
    setApiConfig(config);
    setCurrentExchange(config.exchange || 'binance');
    const cfg = getExchangeConfig(config.exchange || 'binance');
    setSuccess(t('account.switchedTo', { logo: cfg.logo, label: config.label }));
    setTimeout(() => setSuccess(''), 2000);
  };

  const refreshAccount = useCallback(async () => {
    if (!apiConfig) return;
    setLoading(true);
    setError('');
    try {
      setCurrentExchange(apiConfig.exchange || 'binance');
      const data = await getAccountInfo(apiConfig.apiKey, apiConfig.apiSecret);
      const cfg = getExchangeConfig(apiConfig.exchange || 'binance');

      // 过滤掉余额极小的资产
      const significantBalances = data.balances.filter(b => {
        const qty = parseFloat(b.free) + parseFloat(b.locked);
        return qty > 1e-8;
      });

      // 批量获取所有 USDT 交易对价格（1次API调用替代N次）
      const tickers = await getTicker24h();
      const priceMap = new Map<string, number>();
      for (const t of tickers) {
        if (t.symbol.endsWith('USDT')) {
          priceMap.set(t.symbol, parseFloat(t.price));
        }
      }

      let totalUsdtValue = 0;
      for (const balance of significantBalances) {
        if (cfg.quoteAssets.includes(balance.asset)) {
          balance.usdtValue = parseFloat(balance.free) + parseFloat(balance.locked);
        } else {
          const price = priceMap.get(`${balance.asset}USDT`) || 0;
          balance.usdtValue = (parseFloat(balance.free) + parseFloat(balance.locked)) * price;
        }
        totalUsdtValue += balance.usdtValue;
      }
      setAccountInfo({
        totalUsdtValue,
        balances: significantBalances.sort((a, b) => b.usdtValue - a.usdtValue),
        updateTime: Date.now(),
      });
      setIsConnected(true);
    } catch (err: any) {
      setError(err.message);
      setIsConnected(false);
    }
    setLoading(false);
  }, [apiConfig, setAccountInfo, setIsConnected]);

  useEffect(() => {
    if (apiConfig) {
      refreshAccount();
    }
  }, [apiConfig, refreshAccount]);

  // 自动刷新账户数据
  useEffect(() => {
    if (!apiConfig) return;
    const interval = setInterval(refreshAccount, refreshIntervals.account);
    return () => clearInterval(interval);
  }, [apiConfig, refreshAccount, refreshIntervals.account]);

  return (
    <div className={isMobile ? 'space-y-3' : 'space-y-6'}>
      <h1 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>{t('account.title')}</h1>

      {/* Exchange Selector */}
      <div className="card space-y-4">
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
          <Key className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-blue-400`} />
          {isMobile ? t('account.addApiKey') : t('account.addApiKeyFull')}
        </h3>
        <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>
          {t('account.addApiKeyDesc')}
        </p>

        {/* Exchange Grid */}
        <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 sm:grid-cols-4 gap-3'}`}>
          {getExchangeList().map((ex) => (
            <button
              key={ex.id}
              className={`relative ${isMobile ? 'p-2' : 'p-3'} rounded-xl border text-left transition-all duration-200 ${
                selectedExchange === ex.id
                  ? 'border-blue-500 bg-blue-600/10 ring-1 ring-blue-500/30 shadow-lg shadow-blue-500/10'
                  : 'border-slate-800 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50'
              }`}
              onClick={() => setSelectedExchange(ex.id)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={isMobile ? 'text-base' : 'text-xl'}>{ex.logo}</span>
                <span className={`font-semibold ${isMobile ? 'text-xs' : 'text-sm'} ${selectedExchange === ex.id ? 'text-blue-400' : 'text-slate-200'}`}>
                  {ex.name.split(' ')[0]}
                </span>
              </div>
              {!isMobile && <p className="text-sm text-slate-500 line-clamp-1">{ex.features[0]}</p>}
              {selectedExchange === ex.id && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* Selected Exchange Info */}
        <div className={`${isMobile ? 'p-3' : 'p-4'} rounded-xl bg-gradient-to-r from-slate-800/80 to-slate-800/40 border border-slate-700/50`}>
          <div className={`flex items-center justify-between ${isMobile ? 'mb-2' : 'mb-3'}`}>
            <div className="flex items-center gap-2">
              <span className={isMobile ? 'text-2xl' : 'text-3xl'}>{exchangeConfig.logo}</span>
              <div>
                <h4 className={`font-bold ${isMobile ? 'text-base' : 'text-lg'}`}>{exchangeConfig.name}</h4>
                {!isMobile && <p className="text-sm text-slate-500">{exchangeConfig.baseUrl}</p>}
              </div>
            </div>
            <a
              href={exchangeConfig.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 ${isMobile ? 'text-xs' : 'text-sm'} text-blue-400 hover:text-blue-300 transition-colors`}
            >
              {t('account.apiDocs')} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {exchangeConfig.features.map((f, i) => (
              <span key={i} className={`px-2 py-0.5 rounded-full bg-slate-700/50 ${isMobile ? 'text-xs' : 'text-sm'} text-slate-400`}>
                {f}
              </span>
            ))}
            {requiresPassphrase && (
              <span className={`px-2 py-0.5 rounded-full bg-amber-900/30 ${isMobile ? 'text-xs' : 'text-sm'} text-amber-400 border border-amber-700/30`}>
                {t('account.needsPassphrase')}
              </span>
            )}
          </div>
        </div>

        {/* API Key Form */}
        <div className={`grid grid-cols-1 ${isMobile ? '' : 'md:grid-cols-2'} ${isMobile ? 'gap-3' : 'gap-4'}`}>
          <div>
            <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400 block mb-1`}>{t('account.label')}</label>
            <input
              className="input-field"
              placeholder={t('account.labelPlaceholder', { name: exchangeConfig.name.split(' ')[0] })}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400 block mb-1`}>{t('account.apiKey')}</label>
            <input
              className="input-field"
              placeholder={t('account.enterApiKey')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div>
            <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400 block mb-1`}>{t('account.apiSecret')}</label>
            <div className="relative">
              <input
                className="input-field pr-10"
                type={showSecret ? 'text' : 'password'}
                placeholder={t('account.enterApiSecret')}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {requiresPassphrase && (
            <div>
              <label className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400 block mb-1`}>
                Passphrase <span className="text-amber-400">*</span>
              </label>
              <input
                className="input-field"
                type="password"
                placeholder={t('account.enterPassphrase', { name: exchangeConfig.name.split(' ')[0] })}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className={`flex ${isMobile ? 'flex-col gap-2' : 'items-center gap-3'}`}>
          <button className={`btn-primary ${isMobile ? 'text-xs py-2' : ''}`} onClick={handleSave} disabled={loading}>
            {loading ? t('account.saving') : t('account.saveAccount', { name: exchangeConfig.name.split(' ')[0] })}
          </button>
          {error && (
            <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-red-400 flex items-center gap-1`}>
              <AlertCircle className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} /> {error}
            </span>
          )}
          {success && (
            <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-emerald-400 flex items-center gap-1`}>
              <CheckCircle className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} /> {success}
            </span>
          )}
        </div>
      </div>

      {/* Saved API Keys */}
      {savedConfigs && savedConfigs.length > 0 && (
        <div className={`card ${isMobile ? 'space-y-2' : 'space-y-3'}`}>
          <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
            <Wallet className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-blue-400`} />
            {t('account.savedAccounts')}
          </h3>
          {savedConfigs.map((config) => {
            const cfg = getExchangeConfig(config.exchange || 'binance');
            const balInfo = config.id ? accountBalances[config.id] : undefined;
            const isExpanded = config.id ? expandedAccounts.has(config.id) : false;
            const isActive = apiConfig?.id === config.id;
            return (
              <div
                key={config.id}
                className={`rounded-xl border transition-colors ${
                  isActive
                    ? 'border-blue-500 bg-blue-600/5'
                    : 'border-slate-800 bg-slate-800/30 hover:border-slate-700'
                }`}
              >
                {/* 账户头部 */}
                <div
                  className={`flex items-center justify-between ${isMobile ? 'p-3' : 'p-4'} cursor-pointer`}
                  onClick={() => handleSelect(config)}
                >
                  <div className="flex items-center gap-2">
                    <span className={isMobile ? 'text-xl' : 'text-2xl'}>{cfg.logo}</span>
                    <div className="min-w-0">
                      <p className={`${isMobile ? 'text-sm' : ''} font-medium flex items-center gap-1.5`}>
                        <span className="truncate">{config.label}</span>
                        <span className={`${isMobile ? 'text-xs px-1 py-0.5' : 'text-sm px-1.5 py-0.5'} rounded bg-slate-700/50 text-slate-400 shrink-0`}>
                          {cfg.name.split(' ')[0]}
                        </span>
                      </p>
                      <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 mt-0.5`}>
                        {config.apiKey.slice(0, 6)}...{config.apiKey.slice(-4)}
                        {!isMobile && <span className="ml-3">{new Date(config.createdAt).toLocaleDateString()}</span>}
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center ${isMobile ? 'gap-1.5' : 'gap-3'}`}>
                    {/* 总资产显示 */}
                    {balInfo?.loading ? (
                      <Loader2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-blue-400 animate-spin`} />
                    ) : balInfo?.error ? (
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-red-400 flex items-center gap-1`}>
                        <AlertCircle className="w-3 h-3" /> {t('common.failed')}
                      </span>
                    ) : balInfo ? (
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold text-blue-400`}>
                        ${balInfo.totalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ) : null}
                    {isActive && (
                      <span className="badge-green">{t('account.currentlyUsed')}</span>
                    )}
                    <button
                      className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
                      onClick={(e) => { e.stopPropagation(); if (config.id) toggleExpanded(config.id); }}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button
                      className="p-1 rounded text-slate-500 hover:text-red-400 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleDelete(config.id!); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 资产明细展开 */}
                {isExpanded && (
                  <div className={`${isMobile ? 'px-3 pb-3' : 'px-4 pb-4'} border-t border-slate-800/50`}>
                    {balInfo?.loading ? (
                      <div className={`flex items-center gap-2 py-4 ${isMobile ? 'text-xs' : 'text-sm'} text-blue-400`}>
                        <Loader2 className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} animate-spin`} /> {t('account.loadingAssets')}
                      </div>
                    ) : balInfo?.error ? (
                      <div className="py-4 space-y-2">
                        <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-red-400`}>{balInfo.error}</p>
                        <button
                          className={`${isMobile ? 'text-xs' : 'text-sm'} text-blue-400 hover:text-blue-300`}
                          onClick={() => fetchAccountBalances(config)}
                        >
                          {t('connection.retryConnection')}
                        </button>
                      </div>
                    ) : balInfo && balInfo.balances.length > 0 ? (
                      <div className={`pt-3 ${isMobile ? 'space-y-2' : 'space-y-3'}`}>
                        <div className="flex items-center justify-between">
                          <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-400`}>{t('account.totalAssets')}</span>
                          <div className="flex items-center gap-2">
                            <span className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-blue-400`}>
                              ${balInfo.totalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <button
                              className="p-1 rounded text-slate-500 hover:text-blue-400 transition-colors"
                              onClick={() => fetchAccountBalances(config)}
                              title={t('common.refresh')}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* 最小显示价值过滤器 */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('account.minDisplayValue')}</span>
                            <select
                              className="select-field text-xs py-0.5 px-2 w-auto"
                              value={minDisplayValue}
                              onChange={(e) => handleMinValueChange(Number(e.target.value))}
                            >
                              <option value={0}>{t('account.showAll')}</option>
                              <option value={0.01}>≥ $0.01</option>
                              <option value={0.1}>≥ $0.1</option>
                              <option value={1}>≥ $1</option>
                              <option value={5}>≥ $5</option>
                              <option value={10}>≥ $10</option>
                              <option value={50}>≥ $50</option>
                              <option value={100}>≥ $100</option>
                            </select>
                          </div>
                          <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>
                            {balInfo.balances.filter(b => b.usdtValue >= minDisplayValue).length}/{balInfo.balances.length} {t('account.coins')}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className={`w-full ${isMobile ? 'text-xs' : 'text-sm'}`}>
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-800">
                                <th className={`text-left py-1.5 px-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>{t('account.asset')}</th>
                                <th className={`text-right py-1.5 px-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>{t('account.available')}</th>
                                <th className={`text-right py-1.5 px-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>{t('account.locked')}</th>
                                <th className={`text-right py-1.5 px-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>{t('account.estimatedValue')}</th>
                                <th className={`text-right py-1.5 px-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>{t('account.ratio')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {balInfo.balances.filter(b => b.usdtValue >= minDisplayValue).map((b) => (
                                <tr key={b.asset} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                                  <td className="py-1.5 px-2 font-medium text-slate-200">{b.asset}</td>
                                  <td className="text-right py-1.5 px-2 text-slate-300 font-mono">{parseFloat(b.free).toFixed(isMobile ? 4 : 6)}</td>
                                  <td className="text-right py-1.5 px-2 text-slate-500 font-mono">{parseFloat(b.locked).toFixed(isMobile ? 4 : 6)}</td>
                                  <td className="text-right py-1.5 px-2 text-blue-400">${b.usdtValue.toFixed(2)}</td>
                                  <td className="text-right py-1.5 px-2 text-slate-500">
                                    {balInfo.totalUsdt > 0 ? (b.usdtValue / balInfo.totalUsdt * 100).toFixed(1) : '0.0'}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className={`py-4 text-center ${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('account.noAssetData')}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Account Info */}
      {accountInfo && (
        <div className={`card ${isMobile ? 'space-y-3' : 'space-y-4'}`}>
          <div className="flex items-center justify-between">
            <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2`}>
              {apiConfig && (
                <span className={isMobile ? 'text-lg' : 'text-xl'}>{getExchangeConfig(apiConfig.exchange || 'binance').logo}</span>
              )}
              {t('account.assetOverview')}
            </h3>
            <button
              className={`btn-secondary flex items-center gap-1.5 ${isMobile ? 'text-xs' : 'text-sm'}`}
              onClick={refreshAccount}
              disabled={loading}
            >
              <RefreshCw className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${loading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </button>
          </div>

          <div className={`grid ${isMobile ? 'grid-cols-3 gap-2' : 'grid-cols-1 md:grid-cols-3 gap-4'}`}>
            <div className={`${isMobile ? 'p-2.5' : 'p-4'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(15,23,42,0.5) 100%)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('account.totalAssets')}</p>
              <p className={`${isMobile ? 'text-sm' : 'text-2xl'} font-bold text-blue-400 mt-0.5 tracking-tight`}>
                ${accountInfo.totalUsdtValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className={`${isMobile ? 'p-2.5' : 'p-4'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(15,23,42,0.5) 100%)', border: '1px solid rgba(139,92,246,0.15)' }}>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('account.coinCount')}</p>
              <p className={`${isMobile ? 'text-sm' : 'text-2xl'} font-bold mt-0.5 tracking-tight`}>{accountInfo.balances.length}</p>
            </div>
            <div className={`${isMobile ? 'p-2.5' : 'p-4'} rounded-xl`} style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(15,23,42,0.5) 100%)', border: '1px solid rgba(16,185,129,0.15)' }}>
              <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500 font-medium`}>{t('account.lastUpdate')}</p>
              <p className={`${isMobile ? 'text-xs' : 'text-lg'} font-bold mt-0.5 tracking-tight`}>
                {new Date(accountInfo.updateTime).toLocaleTimeString()}
              </p>
            </div>
          </div>

          {/* Balances Table */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-500`}>{t('account.minDisplayValue')}</span>
              <select
                className="select-field text-xs py-0.5 px-2 w-auto"
                value={minDisplayValue}
                onChange={(e) => handleMinValueChange(Number(e.target.value))}
              >
                <option value={0}>{t('account.showAll')}</option>
                <option value={0.01}>≥ $0.01</option>
                <option value={0.1}>≥ $0.1</option>
                <option value={1}>≥ $1</option>
                <option value={5}>≥ $5</option>
                <option value={10}>≥ $10</option>
                <option value={50}>≥ $50</option>
                <option value={100}>≥ $100</option>
              </select>
            </div>
            <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600`}>
              {accountInfo.balances.filter(b => b.usdtValue >= minDisplayValue).length}/{accountInfo.balances.length} {t('account.coins')}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className={`w-full ${isMobile ? 'text-xs' : 'text-sm'}`}>
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className={`text-left py-2 ${isMobile ? 'px-2' : 'px-3'}`}>{t('account.asset')}</th>
                  <th className={`text-right py-2 ${isMobile ? 'px-2' : 'px-3'}`}>{t('account.available')}</th>
                  <th className={`text-right py-2 ${isMobile ? 'px-2' : 'px-3'}`}>{t('account.locked')}</th>
                  <th className={`text-right py-2 ${isMobile ? 'px-2' : 'px-3'}`}>{t('account.estimatedValue')}</th>
                </tr>
              </thead>
              <tbody>
                {accountInfo.balances.filter(b => b.usdtValue >= minDisplayValue).map((b) => (
                  <tr key={b.asset} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className={`py-2 ${isMobile ? 'px-2' : 'px-3'} font-medium`}>{b.asset}</td>
                    <td className={`text-right py-2 ${isMobile ? 'px-2' : 'px-3'} text-slate-300 font-mono`}>{parseFloat(b.free).toFixed(isMobile ? 4 : 6)}</td>
                    <td className={`text-right py-2 ${isMobile ? 'px-2' : 'px-3'} text-slate-500 font-mono`}>{parseFloat(b.locked).toFixed(isMobile ? 4 : 6)}</td>
                    <td className={`text-right py-2 ${isMobile ? 'px-2' : 'px-3'} text-blue-400`}>${b.usdtValue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
