/**
 * Market Data Service
 * 从免费 API 采集实时市场数据，作为信号分析的数据基础
 */

import { getLang as _getLang, getLocale as _getLocale } from './langUtil';

const isDev = import.meta.env.DEV;

// ==================== 类型定义 ====================
export interface MarketNews {
  title: string;
  body: string;
  source: string;
  url: string;
  publishedAt: number;
  categories: string;
}

export interface CoinPrice {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap: number;
}

export interface FearGreedData {
  value: number;
  classification: string; // Extreme Fear / Fear / Neutral / Greed / Extreme Greed
  timestamp: number;
}

export interface TrendingCoin {
  name: string;
  symbol: string;
  marketCapRank: number;
  priceChangePercent24h: number;
}

export interface MarketDataSnapshot {
  timestamp: number;
  news: MarketNews[];
  prices: CoinPrice[];
  fearGreed: FearGreedData | null;
  trending: TrendingCoin[];
  errors: string[];
}

// ==================== Proxy helpers ====================
function proxyUrl(url: string): string {
  if (!isDev) return url;
  // CryptoCompare
  if (url.startsWith('https://min-api.cryptocompare.com')) {
    return url.replace('https://min-api.cryptocompare.com', '/dataapi/cryptocompare');
  }
  // CoinGecko
  if (url.startsWith('https://api.coingecko.com')) {
    return url.replace('https://api.coingecko.com', '/dataapi/coingecko');
  }
  // Alternative.me
  if (url.startsWith('https://api.alternative.me')) {
    return url.replace('https://api.alternative.me', '/dataapi/alternative');
  }
  return url;
}

// ==================== CryptoCompare News ====================
async function fetchCryptoNews(limit = 20): Promise<MarketNews[]> {
  try {
    const url = proxyUrl(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular&limit=${limit}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`CryptoCompare ${res.status}`);
    const data = await res.json();
    return (data.Data || []).map((item: any) => ({
      title: item.title || '',
      body: (item.body || '').slice(0, 300),
      source: item.source_info?.name || item.source || 'Unknown',
      url: item.url || '',
      publishedAt: (item.published_on || 0) * 1000,
      categories: item.categories || '',
    }));
  } catch (err: any) {
    console.warn('CryptoCompare News fetch failed:', err.message);
    return [];
  }
}

// ==================== CoinGecko 行情 ====================
const TRACKED_COINS = [
  'bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple',
  'dogecoin', 'cardano', 'avalanche-2', 'chainlink', 'polkadot',
  'toncoin', 'tron', 'shiba-inu', 'litecoin', 'near',
];

async function fetchCoinPrices(): Promise<CoinPrice[]> {
  try {
    const ids = TRACKED_COINS.join(',');
    const url = proxyUrl(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return data.map((coin: any) => ({
      symbol: (coin.symbol || '').toUpperCase(),
      price: coin.current_price || 0,
      change24h: coin.price_change_24h || 0,
      changePercent24h: coin.price_change_percentage_24h || 0,
      volume24h: coin.total_volume || 0,
      marketCap: coin.market_cap || 0,
    }));
  } catch (err: any) {
    console.warn('CoinGecko prices fetch failed:', err.message);
    return [];
  }
}

// ==================== Fear & Greed Index ====================
async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const url = proxyUrl('https://api.alternative.me/fng/?limit=1');
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Alternative.me ${res.status}`);
    const data = await res.json();
    const entry = data.data?.[0];
    if (!entry) return null;
    return {
      value: Number(entry.value) || 50,
      classification: entry.value_classification || 'Neutral',
      timestamp: Number(entry.timestamp) * 1000 || Date.now(),
    };
  } catch (err: any) {
    console.warn('Fear & Greed fetch failed:', err.message);
    return null;
  }
}

// ==================== CoinGecko Trending ====================
async function fetchTrending(): Promise<TrendingCoin[]> {
  try {
    const url = proxyUrl('https://api.coingecko.com/api/v3/search/trending');
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`CoinGecko trending ${res.status}`);
    const data = await res.json();
    return (data.coins || []).slice(0, 10).map((item: any) => ({
      name: item.item?.name || '',
      symbol: (item.item?.symbol || '').toUpperCase(),
      marketCapRank: item.item?.market_cap_rank || 0,
      priceChangePercent24h: item.item?.data?.price_change_percentage_24h?.usd || 0,
    }));
  } catch (err: any) {
    console.warn('Trending fetch failed:', err.message);
    return [];
  }
}

// ==================== 主采集函数 ====================
export async function collectMarketData(): Promise<MarketDataSnapshot> {
  const errors: string[] = [];

  // 并行抓取所有数据
  const [news, prices, fearGreed, trending] = await Promise.all([
    fetchCryptoNews().catch(e => { errors.push(`News: ${e.message}`); return [] as MarketNews[]; }),
    fetchCoinPrices().catch(e => { errors.push(`Prices: ${e.message}`); return [] as CoinPrice[]; }),
    fetchFearGreed().catch(e => { errors.push(`FearGreed: ${e.message}`); return null; }),
    fetchTrending().catch(e => { errors.push(`Trending: ${e.message}`); return [] as TrendingCoin[]; }),
  ]);

  return {
    timestamp: Date.now(),
    news,
    prices,
    fearGreed,
    trending,
    errors,
  };
}

// ==================== 格式化为 Prompt 文本 ====================
export function formatMarketDataForPrompt(snapshot: MarketDataSnapshot): string {
  const loc = _getLocale();
  const isZh = _getLang() === 'zh';
  const time = new Date(snapshot.timestamp).toLocaleString(loc, { timeZone: 'Asia/Shanghai' });
  let text = `## 📡 ${isZh ? '实时市场数据' : 'Real-time Market Data'} (${isZh ? '采集时间' : 'Collected at'}: ${time})\n`;

  if (snapshot.fearGreed) {
    const fg = snapshot.fearGreed;
    const emoji = fg.value >= 75 ? '🟢' : fg.value >= 55 ? '🟡' : fg.value >= 45 ? '⚪' : fg.value >= 25 ? '🟠' : '🔴';
    text += `\n### ${isZh ? '恐惧贪婪指数' : 'Fear & Greed Index'}\n${emoji} ${fg.value}/100 (${fg.classification})\n`;
  }

  if (snapshot.prices.length > 0) {
    text += `\n### ${isZh ? '主流币行情' : 'Major Coin Prices'}\n`;
    const volLabel = isZh ? '量' : 'Vol';
    const mcLabel = isZh ? '市值' : 'MCap';
    for (const coin of snapshot.prices) {
      const arrow = coin.changePercent24h >= 0 ? '📈' : '📉';
      const sign = coin.changePercent24h >= 0 ? '+' : '';
      text += `${arrow} ${coin.symbol}: $${coin.price.toLocaleString()} (24h ${sign}${coin.changePercent24h.toFixed(2)}%) | ${volLabel} $${(coin.volume24h / 1e9).toFixed(2)}B | ${mcLabel} $${(coin.marketCap / 1e9).toFixed(1)}B\n`;
    }
  }

  if (snapshot.trending.length > 0) {
    text += `\n### ${isZh ? '热门搜索币种' : 'Trending Coins'} (CoinGecko Trending)\n`;
    const rankLabel = isZh ? '市值排名' : 'MCap Rank';
    for (const coin of snapshot.trending) {
      text += `🔥 ${coin.name} (${coin.symbol}) | ${rankLabel} #${coin.marketCapRank || '?'}\n`;
    }
  }

  if (snapshot.news.length > 0) {
    text += `\n### ${isZh ? '最新加密货币新闻 (近24小时)' : 'Latest Crypto News (Past 24h)'}\n`;
    const srcLabel = isZh ? '来源' : 'Source';
    for (const news of snapshot.news.slice(0, 15)) {
      const t = new Date(news.publishedAt).toLocaleString(loc, { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      text += `[${t}] **${news.title}**\n  ${news.body.slice(0, 200)}...\n  ${srcLabel}: ${news.source}\n\n`;
    }
  }

  return text;
}
