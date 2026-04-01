import { hmacSha256, decrypt } from './crypto';
import type { SymbolInfo, TickerInfo, Kline, AssetBalance, ExchangeType } from '../types';
import { getExchangeConfig, EXCHANGE_CONFIGS } from './exchangeConfig';
import type { ExchangeConfig } from '../types';

// 当前活跃交易所 (默认Binance)
let _currentExchange: ExchangeType = 'binance';
let _currentConfig: ExchangeConfig = EXCHANGE_CONFIGS.binance;

export function setCurrentExchange(exchange: ExchangeType) {
  _currentExchange = exchange;
  _currentConfig = getExchangeConfig(exchange);
}

export function getCurrentExchange(): ExchangeType {
  return _currentExchange;
}

export function getCurrentExchangeConfig(): ExchangeConfig {
  return _currentConfig;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  endpoint: string;
  params?: Record<string, string | number>;
  signed?: boolean;
  apiKey?: string;
  apiSecretEncrypted?: string;
  baseUrl?: string; // 允许覆盖
}

const isDev = import.meta.env.DEV;
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
// Web 环境（包括生产构建）需要走代理，只有 Electron 生产环境才直连
const useProxy = isDev || !isElectron;

// 每个交易所独立的服务器时间偏移校正（毫秒）
const _timeOffsets: Record<string, number> = {};
const _timeSynced: Record<string, boolean> = {};

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, key) => o?.[key], obj);
}

async function syncServerTime(): Promise<void> {
  const exchangeId = _currentConfig.id;
  if (_timeSynced[exchangeId]) return;
  if (!_currentConfig.serverTimePath) return;
  try {
    const basePath = useProxy && _currentConfig.proxyPath ? _currentConfig.proxyPath : _currentConfig.baseUrl;
    const url = useProxy && _currentConfig.proxyPath
      ? new URL(`${basePath}${_currentConfig.serverTimePath}`, window.location.origin)
      : new URL(`${basePath}${_currentConfig.serverTimePath}`);
    const before = Date.now();
    const res = await fetch(url.toString());
    const after = Date.now();
    if (res.ok) {
      const data = await res.json();
      const field = _currentConfig.serverTimeField || 'serverTime';
      let serverTime = Number(getNestedValue(data, field));
      // 有些交易所返回秒级时间戳，需要转为毫秒
      if (serverTime > 0 && serverTime < 1e12) serverTime *= 1000;
      if (serverTime > 0) {
        const latency = (after - before) / 2;
        _timeOffsets[exchangeId] = serverTime - before - latency;
        _timeSynced[exchangeId] = true;
        console.log(`[${_currentConfig.name}] 时间偏移校正: ${_timeOffsets[exchangeId]}ms`);
      }
    }
  } catch (e) {
    console.warn(`[${_currentConfig.name}] 时间同步失败，使用本地时间`, e);
  }
}

function getCorrectedTimestamp(): number {
  return Math.round(Date.now() + (_timeOffsets[_currentConfig.id] || 0));
}

async function request<T>(options: RequestOptions): Promise<T> {
  const { method = 'GET', endpoint, params = {}, signed = false, apiKey, apiSecretEncrypted, baseUrl } = options;

  // Web 环境（dev + 生产）使用代理绕过 CORS，Electron 生产环境直连
  let effectiveBaseUrl: string;
  if (baseUrl) {
    effectiveBaseUrl = baseUrl;
  } else if (useProxy && _currentConfig.proxyPath) {
    effectiveBaseUrl = _currentConfig.proxyPath;
  } else {
    effectiveBaseUrl = _currentConfig.baseUrl;
  }

  const url = useProxy && !baseUrl
    ? new URL(`${effectiveBaseUrl}${endpoint}`, window.location.origin)
    : new URL(`${effectiveBaseUrl}${endpoint}`);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  if (signed && apiKey && apiSecretEncrypted) {
    await syncServerTime();
    const timestamp = getCorrectedTimestamp();
    searchParams.set('timestamp', String(timestamp));
    searchParams.set('recvWindow', '10000');
    const queryString = searchParams.toString();
    const secret = decrypt(apiSecretEncrypted);
    const signature = hmacSha256(queryString, secret);
    searchParams.set('signature', signature);
  }

  if (method === 'GET') {
    url.search = searchParams.toString();
  }

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers[_currentConfig.apiKeyHeader] = apiKey;
  }

  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: method !== 'GET' ? searchParams.toString() : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ msg: res.statusText }));
    throw new Error(`${_currentConfig.name} API Error: ${error.msg || error.message || res.statusText} (${error.code || res.status})`);
  }

  return res.json();
}

// ==================== 公共接口 ====================

export async function getExchangeInfo(): Promise<SymbolInfo[]> {
  const data = await request<any>({ endpoint: _currentConfig.endpoints.exchangeInfo });
  return data.symbols
    .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map((s: any) => {
      const priceFilter = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const lotSize = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const minNotional = s.filters.find((f: any) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
      return {
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        pricePrecision: s.quotePrecision,
        quantityPrecision: s.baseAssetPrecision,
        minNotional: parseFloat(minNotional?.minNotional || '10'),
        minQty: parseFloat(lotSize?.minQty || '0.00001'),
        stepSize: lotSize?.stepSize || '0.00001',
        tickSize: priceFilter?.tickSize || '0.01',
      } as SymbolInfo;
    });
}

export async function getTicker24h(symbol?: string): Promise<TickerInfo[]> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  const data = await request<any>({
    endpoint: _currentConfig.endpoints.ticker24h,
    params,
  });
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((t: any) => ({
    symbol: t.symbol,
    price: t.lastPrice,
    priceChangePercent: t.priceChangePercent,
    volume: t.volume,
    quoteVolume: t.quoteVolume,
  }));
}

export async function getPrice(symbol: string): Promise<number> {
  const data = await request<any>({ endpoint: _currentConfig.endpoints.tickerPrice, params: { symbol } });
  return parseFloat(data.price);
}

export async function getKlines(symbol: string, interval: string = '1h', limit: number = 100): Promise<Kline[]> {
  const data = await request<any[]>({ endpoint: _currentConfig.endpoints.klines, params: { symbol, interval, limit: String(limit) } });
  return data.map((k: any) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

// ==================== 需认证接口 ====================

export async function getAccountInfo(apiKey: string, apiSecretEncrypted: string): Promise<{ balances: AssetBalance[] }> {
  const data = await request<any>({
    endpoint: _currentConfig.endpoints.account,
    signed: true,
    apiKey,
    apiSecretEncrypted,
  });
  const balances: AssetBalance[] = data.balances
    .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    .map((b: any) => ({
      asset: b.asset,
      free: b.free,
      locked: b.locked,
      usdtValue: 0,
    }));
  return { balances };
}

export async function placeOrder(params: {
  apiKey: string;
  apiSecretEncrypted: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  quantity: string;
  price?: string;
  timeInForce?: string;
}) {
  const orderParams: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    quantity: params.quantity,
  };
  if (params.type === 'LIMIT') {
    orderParams.price = params.price!;
    orderParams.timeInForce = params.timeInForce || 'GTC';
  }
  return request<any>({
    method: 'POST',
    endpoint: _currentConfig.endpoints.order,
    params: orderParams,
    signed: true,
    apiKey: params.apiKey,
    apiSecretEncrypted: params.apiSecretEncrypted,
  });
}

export async function cancelOrder(apiKey: string, apiSecretEncrypted: string, symbol: string, orderId: string) {
  return request<any>({
    method: 'DELETE',
    endpoint: _currentConfig.endpoints.order,
    params: { symbol, orderId },
    signed: true,
    apiKey,
    apiSecretEncrypted,
  });
}

export async function getAllOrders(apiKey: string, apiSecretEncrypted: string, symbol: string, startTime?: number, limit = 500) {
  const params: Record<string, string | number> = { symbol, limit };
  if (startTime) params.startTime = startTime;
  return request<any[]>({
    endpoint: _currentConfig.endpoints.allOrders,
    params,
    signed: true,
    apiKey,
    apiSecretEncrypted,
  });
}

export async function queryOrder(apiKey: string, apiSecretEncrypted: string, symbol: string, orderId: string) {
  return request<any>({
    endpoint: _currentConfig.endpoints.order,
    params: { symbol, orderId },
    signed: true,
    apiKey,
    apiSecretEncrypted,
  });
}

export async function getMyTrades(apiKey: string, apiSecretEncrypted: string, symbol: string, orderId?: string) {
  const params: Record<string, string | number> = { symbol };
  if (orderId) params.orderId = orderId;
  const endpoint = _currentConfig.endpoints.myTrades || '/api/v3/myTrades';
  return request<any[]>({
    endpoint,
    params,
    signed: true,
    apiKey,
    apiSecretEncrypted,
  });
}

export async function getOpenOrders(apiKey: string, apiSecretEncrypted: string, symbol?: string) {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return request<any[]>({
    endpoint: _currentConfig.endpoints.openOrders,
    params,
    signed: true,
    apiKey,
    apiSecretEncrypted,
  });
}
