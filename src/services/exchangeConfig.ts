import type { ExchangeConfig, ExchangeType } from '../types';

const EXCHANGE_I18N: Record<ExchangeType, { name: { zh: string; en: string }; features: { zh: string[]; en: string[] } }> = {
  binance: {
    name: { zh: 'Binance 币安', en: 'Binance' },
    features: { zh: ['全球最大交易所', '交易对最多', '流动性最强', '手续费 0.1%'], en: ['Largest global exchange', 'Most trading pairs', 'Best liquidity', 'Fee 0.1%'] },
  },
  okx: {
    name: { zh: 'OKX 欧易', en: 'OKX' },
    features: { zh: ['衍生品丰富', '统一账户', '需要Passphrase', '手续费 0.08%-0.1%'], en: ['Rich derivatives', 'Unified account', 'Requires Passphrase', 'Fee 0.08%-0.1%'] },
  },
  bybit: {
    name: { zh: 'Bybit', en: 'Bybit' },
    features: { zh: ['衍生品强劲', '统一交易账户', '手续费 0.1%', '跟单交易'], en: ['Strong derivatives', 'Unified trading account', 'Fee 0.1%', 'Copy trading'] },
  },
  gate: {
    name: { zh: 'Gate.io 芝麻开门', en: 'Gate.io' },
    features: { zh: ['币种最多', '新币上线快', '手续费 0.2%', '量化API友好'], en: ['Most coins listed', 'Fast new listings', 'Fee 0.2%', 'Quant-friendly API'] },
  },
  bitget: {
    name: { zh: 'Bitget', en: 'Bitget' },
    features: { zh: ['跟单社交交易', '需要Passphrase', '手续费 0.1%', '合约强'], en: ['Social copy trading', 'Requires Passphrase', 'Fee 0.1%', 'Strong futures'] },
  },
  kucoin: {
    name: { zh: 'KuCoin 库币', en: 'KuCoin' },
    features: { zh: ['新币种丰富', '需要Passphrase', '手续费 0.1%', 'API友好'], en: ['Rich new coins', 'Requires Passphrase', 'Fee 0.1%', 'API-friendly'] },
  },
  huobi: {
    name: { zh: 'HTX (原火币)', en: 'HTX (ex-Huobi)' },
    features: { zh: ['老牌交易所', '品牌更名HTX', '手续费 0.2%', '亚太用户多'], en: ['Established exchange', 'Rebranded to HTX', 'Fee 0.2%', 'Popular in Asia'] },
  },
  mexc: {
    name: { zh: 'MEXC 抹茶', en: 'MEXC' },
    features: { zh: ['小币种多', '零手续费活动', 'Binance兼容API', '上币快'], en: ['Many altcoins', 'Zero-fee events', 'Binance-compatible API', 'Fast listings'] },
  },
};

function getLang(): 'zh' | 'en' {
  try {
    const stored = localStorage.getItem('aags_language');
    if (stored === 'zh' || stored === 'en') return stored;
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) return 'zh';
  } catch {}
  return 'en';
}

export const EXCHANGE_CONFIGS: Record<ExchangeType, ExchangeConfig> = {
  binance: {
    id: 'binance',
    name: 'Binance 币安',
    logo: '🟡',
    baseUrl: 'https://api.binance.com',
    proxyPath: '/proxy/binance',
    wsUrl: 'wss://stream.binance.com:9443/ws',
    apiKeyHeader: 'X-MBX-APIKEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT', 'BUSD', 'USDC'],
    features: ['全球最大交易所', '交易对最多', '流动性最强', '手续费 0.1%'],
    docUrl: 'https://binance-docs.github.io/apidocs/spot/en/',
    serverTimePath: '/api/v3/time',
    serverTimeField: 'serverTime',
    endpoints: {
      exchangeInfo: '/api/v3/exchangeInfo',
      ticker24h: '/api/v3/ticker/24hr',
      tickerPrice: '/api/v3/ticker/price',
      klines: '/api/v3/klines',
      account: '/api/v3/account',
      order: '/api/v3/order',
      openOrders: '/api/v3/openOrders',
      allOrders: '/api/v3/allOrders',
      myTrades: '/api/v3/myTrades',
    },
  },
  okx: {
    id: 'okx',
    name: 'OKX 欧易',
    logo: '⚫',
    baseUrl: 'https://www.okx.com',
    proxyPath: '/proxy/okx',
    wsUrl: 'wss://ws.okx.com:8443/ws/v5/public',
    apiKeyHeader: 'OK-ACCESS-KEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT', 'USDC'],
    features: ['衍生品丰富', '统一账户', '需要Passphrase', '手续费 0.08%-0.1%'],
    docUrl: 'https://www.okx.com/docs-v5/',
    serverTimePath: '/api/v5/public/time',
    serverTimeField: 'data.0.ts',
    endpoints: {
      exchangeInfo: '/api/v5/public/instruments',
      ticker24h: '/api/v5/market/tickers',
      tickerPrice: '/api/v5/market/ticker',
      klines: '/api/v5/market/candles',
      account: '/api/v5/account/balance',
      order: '/api/v5/trade/order',
      openOrders: '/api/v5/trade/orders-pending',
      allOrders: '/api/v5/trade/orders-history',
    },
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    logo: '🔶',
    baseUrl: 'https://api.bybit.com',
    proxyPath: '/proxy/bybit',
    wsUrl: 'wss://stream.bybit.com/v5/public/spot',
    apiKeyHeader: 'X-BAPI-API-KEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT', 'USDC'],
    features: ['衍生品强劲', '统一交易账户', '手续费 0.1%', '跟单交易'],
    docUrl: 'https://bybit-exchange.github.io/docs/',
    serverTimePath: '/v5/market/time',
    serverTimeField: 'result.timeSecond',
    endpoints: {
      exchangeInfo: '/v5/market/instruments-info',
      ticker24h: '/v5/market/tickers',
      tickerPrice: '/v5/market/tickers',
      klines: '/v5/market/kline',
      account: '/v5/account/wallet-balance',
      order: '/v5/order/create',
      openOrders: '/v5/order/realtime',
      allOrders: '/v5/order/history',
    },
  },
  gate: {
    id: 'gate',
    name: 'Gate.io 芝麻开门',
    logo: '🔵',
    baseUrl: 'https://api.gateio.ws',
    proxyPath: '/proxy/gate',
    wsUrl: 'wss://api.gateio.ws/ws/v4/',
    apiKeyHeader: 'KEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT'],
    features: ['币种最多', '新币上线快', '手续费 0.2%', '量化API友好'],
    docUrl: 'https://www.gate.io/docs/developers/apiv4/',
    serverTimePath: '/api/v4/spot/time',
    serverTimeField: 'server_time',
    endpoints: {
      exchangeInfo: '/api/v4/spot/currency_pairs',
      ticker24h: '/api/v4/spot/tickers',
      tickerPrice: '/api/v4/spot/tickers',
      klines: '/api/v4/spot/candlesticks',
      account: '/api/v4/spot/accounts',
      order: '/api/v4/spot/orders',
      openOrders: '/api/v4/spot/orders',
      allOrders: '/api/v4/spot/orders',
    },
  },
  bitget: {
    id: 'bitget',
    name: 'Bitget',
    logo: '🟢',
    baseUrl: 'https://api.bitget.com',
    proxyPath: '/proxy/bitget',
    wsUrl: 'wss://ws.bitget.com/v2/ws/public',
    apiKeyHeader: 'ACCESS-KEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT', 'USDC'],
    features: ['跟单社交交易', '需要Passphrase', '手续费 0.1%', '合约强'],
    docUrl: 'https://www.bitget.com/api-doc/',
    serverTimePath: '/api/v2/public/time',
    serverTimeField: 'data.serverTime',
    endpoints: {
      exchangeInfo: '/api/v2/spot/public/symbols',
      ticker24h: '/api/v2/spot/market/tickers',
      tickerPrice: '/api/v2/spot/market/tickers',
      klines: '/api/v2/spot/market/candles',
      account: '/api/v2/spot/account/assets',
      order: '/api/v2/spot/trade/place-order',
      openOrders: '/api/v2/spot/trade/unfilled-orders',
      allOrders: '/api/v2/spot/trade/history-orders',
    },
  },
  kucoin: {
    id: 'kucoin',
    name: 'KuCoin 库币',
    logo: '🟣',
    baseUrl: 'https://api.kucoin.com',
    proxyPath: '/proxy/kucoin',
    wsUrl: 'wss://ws-api-spot.kucoin.com',
    apiKeyHeader: 'KC-API-KEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT', 'USDC'],
    features: ['新币种丰富', '需要Passphrase', '手续费 0.1%', 'API友好'],
    docUrl: 'https://docs.kucoin.com/',
    serverTimePath: '/api/v1/timestamp',
    serverTimeField: 'data',
    endpoints: {
      exchangeInfo: '/api/v2/symbols',
      ticker24h: '/api/v1/market/allTickers',
      tickerPrice: '/api/v1/market/orderbook/level1',
      klines: '/api/v1/market/candles',
      account: '/api/v1/accounts',
      order: '/api/v1/orders',
      openOrders: '/api/v1/orders',
      allOrders: '/api/v1/orders',
    },
  },
  huobi: {
    id: 'huobi',
    name: 'HTX (原火币)',
    logo: '🔴',
    baseUrl: 'https://api.huobi.pro',
    proxyPath: '/proxy/huobi',
    wsUrl: 'wss://api.huobi.pro/ws',
    apiKeyHeader: 'AccessKeyId',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT'],
    features: ['老牌交易所', '品牌更名HTX', '手续费 0.2%', '亚太用户多'],
    docUrl: 'https://huobiapi.github.io/docs/spot/v1/en/',
    serverTimePath: '/v1/common/timestamp',
    serverTimeField: 'data',
    endpoints: {
      exchangeInfo: '/v2/settings/common/symbols',
      ticker24h: '/market/tickers',
      tickerPrice: '/market/detail/merged',
      klines: '/market/history/kline',
      account: '/v1/account/accounts',
      order: '/v1/order/orders/place',
      openOrders: '/v1/order/openOrders',
      allOrders: '/v1/order/orders',
    },
  },
  mexc: {
    id: 'mexc',
    name: 'MEXC 抹茶',
    logo: '💚',
    baseUrl: 'https://api.mexc.com',
    proxyPath: '/proxy/mexc',
    wsUrl: 'wss://wbs.mexc.com/ws',
    apiKeyHeader: 'X-MEXC-APIKEY',
    signatureMethod: 'hmac-sha256',
    quoteAssets: ['USDT'],
    features: ['小币种多', '零手续费活动', 'Binance兼容API', '上币快'],
    docUrl: 'https://mexcdevelop.github.io/apidocs/',
    serverTimePath: '/api/v3/time',
    serverTimeField: 'serverTime',
    endpoints: {
      exchangeInfo: '/api/v3/exchangeInfo',
      ticker24h: '/api/v3/ticker/24hr',
      tickerPrice: '/api/v3/ticker/price',
      klines: '/api/v3/klines',
      account: '/api/v3/account',
      order: '/api/v3/order',
      openOrders: '/api/v3/openOrders',
      allOrders: '/api/v3/allOrders',
    },
  },
};

export const EXCHANGE_LIST = Object.values(EXCHANGE_CONFIGS);

export function getExchangeConfig(exchange: ExchangeType): ExchangeConfig {
  const config = EXCHANGE_CONFIGS[exchange];
  const lang = getLang();
  const i18n = EXCHANGE_I18N[exchange];
  if (i18n) {
    return { ...config, name: i18n.name[lang], features: i18n.features[lang] };
  }
  return config;
}

export function getExchangeList(): ExchangeConfig[] {
  const lang = getLang();
  return Object.values(EXCHANGE_CONFIGS).map(config => {
    const i18n = EXCHANGE_I18N[config.id];
    if (i18n) return { ...config, name: i18n.name[lang], features: i18n.features[lang] };
    return config;
  });
}

export function needsPassphrase(exchange: ExchangeType): boolean {
  return ['okx', 'bitget', 'kucoin'].includes(exchange);
}
