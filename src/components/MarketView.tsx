import { useState, useEffect, useMemo } from 'react';
import { Search, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getExchangeInfo, getTicker24h } from '../services/binance';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTranslation } from 'react-i18next';

export default function MarketView() {
  const { symbols, setSymbols, tickers, setTickers, setSelectedSymbol, setActiveTab, refreshIntervals } = useStore();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'volume' | 'change' | 'name'>('volume');

  const loadData = async () => {
    setLoading(true);
    try {
      const [symbolData, tickerData] = await Promise.all([
        symbols.length === 0 ? getExchangeInfo() : Promise.resolve(symbols),
        getTicker24h(),
      ]);
      if (symbols.length === 0) setSymbols(symbolData);
      setTickers(tickerData.filter((t) => t.symbol.endsWith('USDT')));
    } catch (err) {
      console.error('Failed to load market data:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, refreshIntervals.market);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshIntervals.market]);

  const filteredTickers = useMemo(() => {
    let arr = Array.from(tickers.values());
    if (search) {
      const q = search.toUpperCase();
      arr = arr.filter((t) => t.symbol.includes(q));
    }
    arr.sort((a, b) => {
      if (sortBy === 'volume') return parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume);
      if (sortBy === 'change') return Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent));
      return a.symbol.localeCompare(b.symbol);
    });
    return arr.slice(0, 200);
  }, [tickers, search, sortBy]);

  const handleSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTab('strategies');
  };

  return (
    <div className={isMobile ? 'space-y-3' : 'space-y-6'}>
      <div className="flex items-center justify-between">
        <h1 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent`}>{t('market.title')}</h1>
        <button className={`btn-secondary flex items-center gap-1.5 ${isMobile ? 'text-xs' : 'text-sm'}`} onClick={loadData} disabled={loading}>
          <RefreshCw className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Search & Filter */}
      <div className={`flex ${isMobile ? 'flex-col gap-2' : 'items-center gap-4'}`}>
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-md'}`}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            className="input-field pl-10"
            placeholder={t('market.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(['volume', 'change', 'name'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`${isMobile ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'} font-medium rounded-xl transition-all duration-200 ${
                sortBy === key
                  ? 'text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              style={sortBy === key ? { background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', boxShadow: '0 2px 10px -2px rgba(99,102,241,0.4)' } : { background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(51,65,85,0.3)' }}
            >
              {t(`market.sortOptions.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className={`w-full ${isMobile ? 'text-xs' : 'text-sm'}`}>
          <thead>
            <tr className={`text-slate-500 ${isMobile ? 'text-xs' : 'text-sm'} font-medium`} style={{ borderBottom: '1px solid rgba(51,65,85,0.4)' }}>
              <th className={`text-left ${isMobile ? 'py-2 px-2' : 'py-3 px-3'}`}>{t('market.table.pair')}</th>
              <th className={`text-right ${isMobile ? 'py-2 px-2' : 'py-3 px-3'}`}>{t('market.table.price')}</th>
              <th className={`text-right ${isMobile ? 'py-2 px-2' : 'py-3 px-3'}`}>{t('market.table.change24h')}</th>
              {!isMobile && <th className="text-right py-3 px-3">{t('market.table.volume')}</th>}
              <th className={`text-right ${isMobile ? 'py-2 px-1' : 'py-3 px-3'}`}>{t('market.table.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredTickers.map((ticker) => {
              const change = parseFloat(ticker.priceChangePercent);
              const isUp = change >= 0;
              const vol = parseFloat(ticker.quoteVolume);
              return (
                <tr key={ticker.symbol} className="transition-all duration-150 hover:bg-white/[0.02]" style={{ borderBottom: '1px solid rgba(51,65,85,0.25)' }}>
                  <td className={`${isMobile ? 'py-2 px-2' : 'py-3 px-3'}`}>
                    <span className="font-medium">{ticker.symbol.replace('USDT', '')}</span>
                    {!isMobile && <span className="text-slate-500">/USDT</span>}
                  </td>
                  <td className={`text-right ${isMobile ? 'py-2 px-2' : 'py-3 px-3'} font-mono`}>{parseFloat(ticker.price).toLocaleString()}</td>
                  <td className={`text-right ${isMobile ? 'py-2 px-2' : 'py-3 px-3'} font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {isUp ? <ArrowUpRight className={isMobile ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> : <ArrowDownRight className={isMobile ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
                      {Math.abs(change).toFixed(2)}%
                    </span>
                  </td>
                  {!isMobile && (
                    <td className="text-right py-3 px-3 text-slate-300">
                      {vol > 1e9 ? `${(vol / 1e9).toFixed(2)}B` :
                       vol > 1e6 ? `${(vol / 1e6).toFixed(2)}M` :
                       vol > 1e3 ? `${(vol / 1e3).toFixed(1)}K` :
                       vol.toFixed(0)}
                    </td>
                  )}
                  <td className={`text-right ${isMobile ? 'py-2 px-1' : 'py-3 px-3'}`}>
                    <button
                      className={`text-blue-400 hover:text-blue-300 ${isMobile ? 'text-xs' : 'text-sm'}`}
                      onClick={() => handleSelect(ticker.symbol)}
                    >
                      {isMobile ? t('market.createShort') : t('market.createStrategy')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredTickers.length === 0 && (
          <div className={`${isMobile ? 'py-8' : 'py-12'} text-center text-slate-600 ${isMobile ? 'text-sm' : ''}`}>
            {loading ? t('common.loading') : t('market.noResults')}
          </div>
        )}
      </div>
    </div>
  );
}
