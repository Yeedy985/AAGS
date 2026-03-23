import { useEffect, useCallback, useRef } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AccountManager from './components/AccountManager';
import MarketView from './components/MarketView';
import StrategyManager from './components/StrategyManager';
import RiskControl from './components/RiskControl';
import Reports from './components/Reports';
import SentimentMonitor from './components/SentimentMonitor';
import EventAlertPage from './components/EventAlert';
import Settings from './components/Settings';
import VersionUpdate from './components/VersionUpdate';
import AppUpdater from './components/AppUpdater';
import { useStore } from './store/useStore';
import { db } from './db';
import { getTicker24h, getAccountInfo, getPrice, setCurrentExchange } from './services/binance';
import { getExchangeConfig } from './services/exchangeConfig';
import { setExecutorCallbacks, syncAllStrategiesOrders } from './services/strategyExecutor';
import { startHeartbeatService } from './services/heartbeatService';

function App() {
  const { activeTab, setStrategies, setApiConfig, apiConfig, setIsConnected, setTickers, setAccountInfo, refreshIntervals, updateStrategy, symbols } = useStore();

  // 全局 ticker 加载（所有页面都能用最新价）
  const loadTickers = useCallback(async () => {
    try {
      const data = await getTicker24h();
      setTickers(data.filter((t) => t.symbol.endsWith('USDT')));
    } catch {
      // 静默失败，下次轮询再试
    }
  }, [setTickers]);

  // 初始化策略执行引擎回调（全局，无论在哪个页面都能响应策略更新）
  useEffect(() => {
    setExecutorCallbacks({
      onStrategyUpdate: (s) => updateStrategy(s),
    });
  }, [updateStrategy]);

  // 启动时自动从 IndexedDB 加载 API 配置和策略，并完整同步挂单
  const startupSyncDone = useRef(false);
  useEffect(() => {
    db.strategies.toArray().then(setStrategies);

    // 自动加载已保存的 API Key
    if (!apiConfig) {
      db.apiConfigs.toArray().then((configs) => {
        if (configs.length > 0) {
          const first = configs[0];
          setApiConfig(first);
          setIsConnected(true);
          setCurrentExchange(first.exchange || 'binance');
        }
      });
    }
  }, [setStrategies, setApiConfig, apiConfig, setIsConnected]);

  // apiConfig 和 symbols 都就绪后，执行一次完整挂单同步
  useEffect(() => {
    if (startupSyncDone.current || !apiConfig || symbols.length === 0) return;
    startupSyncDone.current = true;

    console.log('[全局] 启动时自动同步所有策略挂单...');
    syncAllStrategiesOrders(apiConfig, symbols, (msg) => {
      console.log(`[全局同步] ${msg}`);
    }).then((results) => {
      const total = results.reduce((a, r) => a + r.placedAfter, 0);
      console.log(`[全局] 同步完成: ${results.length} 个策略, 共 ${total} 个挂单`);
      // 刷新策略列表
      db.strategies.toArray().then(setStrategies);
    }).catch((err) => {
      console.error('[全局] 启动同步失败:', err);
    });
  }, [apiConfig, symbols, setStrategies]);

  // 全局账户资产刷新
  const refreshAccountInfo = useCallback(async () => {
    if (!apiConfig) return;
    try {
      setCurrentExchange(apiConfig.exchange || 'binance');
      const data = await getAccountInfo(apiConfig.apiKey, apiConfig.apiSecret);
      const cfg = getExchangeConfig(apiConfig.exchange || 'binance');
      let totalUsdtValue = 0;
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
        totalUsdtValue += balance.usdtValue;
      }
      setAccountInfo({
        totalUsdtValue,
        balances: data.balances.sort((a, b) => b.usdtValue - a.usdtValue),
        updateTime: Date.now(),
      });
      setIsConnected(true);

      // 记录全局净值快照（strategyId=0 代表全局），每次刷新都记录
      try {
        const coinBalances = data.balances.filter(b => !['USDT', 'BUSD', 'USDC', 'FDUSD'].includes(b.asset));
        const coinValue = coinBalances.reduce((sum, b) => sum + (b.usdtValue || 0), 0);
        const usdtVal = totalUsdtValue - coinValue;
        await db.equitySnapshots.add({
          strategyId: 0,
          totalValue: totalUsdtValue,
          coinValue,
          usdtValue: usdtVal,
          unrealizedPnl: 0,
          timestamp: Date.now(),
        });
      } catch {
        // 快照写入失败不影响主流程
      }
    } catch {
      // 静默失败，下次轮询再试
    }
  }, [apiConfig, setAccountInfo, setIsConnected]);

  // 启动时立即加载账户资产，之后按配置间隔定时刷新
  useEffect(() => {
    if (apiConfig) refreshAccountInfo();
  }, [apiConfig, refreshAccountInfo]);

  useEffect(() => {
    if (!apiConfig) return;
    const timer = setInterval(refreshAccountInfo, refreshIntervals.account);
    return () => clearInterval(timer);
  }, [apiConfig, refreshAccountInfo, refreshIntervals.account]);

  // 定时刷新 tickers（启动时立即加载，之后每 30 秒刷新）
  useEffect(() => {
    loadTickers();
    const timer = setInterval(loadTickers, 30000);
    return () => clearInterval(timer);
  }, [loadTickers]);

  // 启动后台心跳服务：只要 AAGS 打开就持续为已分享策略发送心跳，不依赖页面可见
  useEffect(() => {
    startHeartbeatService();
  }, []);

  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'account': return <AccountManager />;
      case 'market': return <MarketView />;
      case 'strategies': return <StrategyManager />;
      case 'risk': return <RiskControl />;
      case 'reports': return <Reports />;
      case 'sentiment': return <SentimentMonitor />;
      case 'alerts': return <EventAlertPage />;
      case 'settings': return <Settings />;
      case 'version': return <VersionUpdate />;
      default: return <Dashboard />;
    }
  };

  return (
    <>
      <Layout>
        {renderPage()}
      </Layout>
      <AppUpdater />
    </>
  );
}

export default App
