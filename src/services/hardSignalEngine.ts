/**
 * Hard Signal Engine — 硬信号触发引擎
 * 
 * "数据驱动触发，AI驱动解释"
 * 
 * 从免费 API 采集实时市场数据，通过硬阈值自动触发 G6/G7 信号，
 * 生成 SignalEvent 注入评分引擎，消除 LLM 延迟和主观性。
 * 
 * 数据源:
 * - Binance Futures API (免费): 资金费率/OI/多空比/Taker比
 * - Binance Spot API (免费): 盘口深度/成交量
 * - Alternative.me (免费): Fear & Greed Index
 * - CoinGecko (免费): BTC Dominance
 */

import type { SignalEvent, SignalGroup } from '../types';

const isDev = import.meta.env.DEV;

// ==================== API URL Helpers ====================
function binanceFuturesUrl(path: string): string {
  return isDev ? `/proxy/binance-futures${path}` : `https://fapi.binance.com${path}`;
}
function binanceSpotUrl(path: string): string {
  return isDev ? `/proxy/binance${path}` : `https://api.binance.com${path}`;
}
function alternativeUrl(path: string): string {
  return isDev ? `/dataapi/alternative${path}` : `https://api.alternative.me${path}`;
}
function coingeckoUrl(path: string): string {
  return isDev ? `/dataapi/coingecko${path}` : `https://api.coingecko.com${path}`;
}

// ==================== 原始数据类型 ====================
export interface HardMarketData {
  timestamp: number;
  // Binance Futures
  btcFundingRate: number | null;     // BTC 永续资金费率
  ethFundingRate: number | null;     // ETH 永续资金费率
  btcOpenInterest: number | null;    // BTC 未平仓合约 (USDT)
  ethOpenInterest: number | null;    // ETH 未平仓合约 (USDT)
  btcLongShortRatio: number | null;  // BTC 多空比 (顶级交易者)
  btcTakerRatio: number | null;      // BTC Taker买卖比
  // Binance Spot
  btcPrice: number | null;
  btcVolume24h: number | null;       // BTC 24h成交量 (USDT)
  btcBidDepth: number | null;        // 买盘深度 (±1%)
  btcAskDepth: number | null;        // 卖盘深度 (±1%)
  // Alternative.me
  fearGreedIndex: number | null;     // 恐慌贪婪指数 0-100
  fearGreedClass: string | null;
  // CoinGecko
  btcDominance: number | null;       // BTC 市值占比 %
  // 采集错误
  errors: string[];
}

// ==================== 硬信号触发规则 ====================
interface HardSignalRule {
  signalId: number;
  group: SignalGroup;
  name: string;
  category: 'D' | 'V' | 'R';
  halfLife: number;
  evaluate: (data: HardMarketData) => { triggered: boolean; impact: number; confidence: number; summary: string } | null;
}

const HARD_SIGNAL_RULES: HardSignalRule[] = [
  // ========== G6 市场结构 ==========
  // #161 BTC 永续合约资金费率
  {
    signalId: 161, group: 'G6', name: 'BTC资金费率', category: 'V', halfLife: 120,
    evaluate: (d) => {
      if (d.btcFundingRate == null) return null;
      const rate = d.btcFundingRate;
      if (rate > 0.001) return { triggered: true, impact: -15, confidence: 0.9, summary: `BTC资金费率极高 ${(rate * 100).toFixed(4)}%，多头过度杠杆` };
      if (rate > 0.0005) return { triggered: true, impact: -8, confidence: 0.8, summary: `BTC资金费率偏高 ${(rate * 100).toFixed(4)}%，多头情绪过热` };
      if (rate < -0.0005) return { triggered: true, impact: 12, confidence: 0.85, summary: `BTC资金费率为负 ${(rate * 100).toFixed(4)}%，空头占优/潜在反弹` };
      if (rate < -0.001) return { triggered: true, impact: 15, confidence: 0.9, summary: `BTC资金费率极低 ${(rate * 100).toFixed(4)}%，极度恐慌/反转信号` };
      return null; // 正常范围不触发
    },
  },
  // #162 ETH 永续合约资金费率
  {
    signalId: 162, group: 'G6', name: 'ETH资金费率', category: 'V', halfLife: 120,
    evaluate: (d) => {
      if (d.ethFundingRate == null) return null;
      const rate = d.ethFundingRate;
      if (rate > 0.001) return { triggered: true, impact: -12, confidence: 0.85, summary: `ETH资金费率极高 ${(rate * 100).toFixed(4)}%` };
      if (rate > 0.0005) return { triggered: true, impact: -6, confidence: 0.75, summary: `ETH资金费率偏高 ${(rate * 100).toFixed(4)}%` };
      if (rate < -0.0005) return { triggered: true, impact: 10, confidence: 0.8, summary: `ETH资金费率为负 ${(rate * 100).toFixed(4)}%` };
      if (rate < -0.001) return { triggered: true, impact: 12, confidence: 0.85, summary: `ETH资金费率极低 ${(rate * 100).toFixed(4)}%` };
      return null;
    },
  },
  // #166 BTC 未平仓合约 OI (需要与历史对比，这里用绝对值判断极端)
  {
    signalId: 166, group: 'G6', name: 'BTC OI变动', category: 'V', halfLife: 360,
    evaluate: (d) => {
      if (d.btcOpenInterest == null) return null;
      // OI > 300亿USDT 视为极高杠杆
      const oiBillions = d.btcOpenInterest / 1e9;
      if (oiBillions > 30) return { triggered: true, impact: -8, confidence: 0.75, summary: `BTC OI极高 $${oiBillions.toFixed(1)}B，杠杆风险` };
      if (oiBillions > 25) return { triggered: true, impact: 5, confidence: 0.7, summary: `BTC OI较高 $${oiBillions.toFixed(1)}B，市场活跃` };
      return null;
    },
  },
  // #169 BTC 多空比 (Long/Short Ratio)
  {
    signalId: 169, group: 'G6', name: 'BTC多空比', category: 'D', halfLife: 120,
    evaluate: (d) => {
      if (d.btcLongShortRatio == null) return null;
      const ratio = d.btcLongShortRatio;
      // ratio > 1 = 多头多, < 1 = 空头多
      if (ratio > 2.5) return { triggered: true, impact: -10, confidence: 0.8, summary: `多空比极端偏多 ${ratio.toFixed(2)}，多头拥挤/潜在回调` };
      if (ratio > 1.8) return { triggered: true, impact: -5, confidence: 0.7, summary: `多空比偏多 ${ratio.toFixed(2)}，多头情绪强` };
      if (ratio < 0.5) return { triggered: true, impact: 10, confidence: 0.8, summary: `多空比极端偏空 ${ratio.toFixed(2)}，空头拥挤/潜在反弹` };
      if (ratio < 0.7) return { triggered: true, impact: 5, confidence: 0.7, summary: `多空比偏空 ${ratio.toFixed(2)}，空头较多` };
      return null;
    },
  },
  // #174 BTC盘口 买±1%深度
  {
    signalId: 174, group: 'G6', name: 'BTC买盘深度', category: 'D', halfLife: 60,
    evaluate: (d) => {
      if (d.btcBidDepth == null || d.btcAskDepth == null) return null;
      const ratio = d.btcBidDepth / (d.btcAskDepth || 1);
      if (ratio > 2.0) return { triggered: true, impact: 15, confidence: 0.85, summary: `买盘深度远超卖盘 (${ratio.toFixed(1)}x)，强支撑` };
      if (ratio > 1.5) return { triggered: true, impact: 8, confidence: 0.75, summary: `买盘深度优于卖盘 (${ratio.toFixed(1)}x)` };
      if (ratio < 0.5) return { triggered: true, impact: -15, confidence: 0.85, summary: `卖盘远超买盘 (买/卖=${ratio.toFixed(2)})，卖压沉重` };
      if (ratio < 0.7) return { triggered: true, impact: -8, confidence: 0.75, summary: `卖盘强于买盘 (买/卖=${ratio.toFixed(2)})` };
      return null;
    },
  },
  // #175 BTC盘口 卖±1%深度 (与#174互补，用于单独卖盘评估)
  {
    signalId: 175, group: 'G6', name: 'BTC卖盘深度', category: 'D', halfLife: 60,
    evaluate: (d) => {
      if (d.btcBidDepth == null || d.btcAskDepth == null) return null;
      const ratio = d.btcAskDepth / (d.btcBidDepth || 1);
      if (ratio > 2.0) return { triggered: true, impact: -12, confidence: 0.85, summary: `卖盘厚度远超买盘 (${ratio.toFixed(1)}x)，上方阻力大` };
      if (ratio < 0.5) return { triggered: true, impact: 12, confidence: 0.85, summary: `卖盘薄弱，上方阻力小 (卖/买=${ratio.toFixed(2)})` };
      return null;
    },
  },
  // #187 全网杠杆率 (通过 OI/市值粗略估算)
  {
    signalId: 187, group: 'G6', name: '估算杠杆率', category: 'R', halfLife: 360,
    evaluate: (d) => {
      if (d.btcOpenInterest == null || d.btcPrice == null) return null;
      // 粗略: BTC总供应约1950万, 市值 = price * 19.5M, 杠杆 ≈ OI / 市值
      const marketCap = d.btcPrice * 19_500_000;
      const leverage = d.btcOpenInterest / marketCap;
      if (leverage > 0.35) return { triggered: true, impact: -10, confidence: 0.85, summary: `估算杠杆率极高 ${(leverage * 100).toFixed(1)}%，爆仓风险显著` };
      if (leverage > 0.25) return { triggered: true, impact: -5, confidence: 0.75, summary: `估算杠杆率偏高 ${(leverage * 100).toFixed(1)}%` };
      return null;
    },
  },
  // #188 Taker Buy/Sell Volume比
  {
    signalId: 188, group: 'G6', name: '主买/主卖比', category: 'D', halfLife: 120,
    evaluate: (d) => {
      if (d.btcTakerRatio == null) return null;
      const ratio = d.btcTakerRatio;
      if (ratio > 1.3) return { triggered: true, impact: 8, confidence: 0.8, summary: `Taker主买远强于主卖 (${ratio.toFixed(2)})，买方主导` };
      if (ratio > 1.15) return { triggered: true, impact: 4, confidence: 0.7, summary: `Taker偏向主买 (${ratio.toFixed(2)})` };
      if (ratio < 0.7) return { triggered: true, impact: -8, confidence: 0.8, summary: `Taker主卖远强于主买 (${ratio.toFixed(2)})，卖方主导` };
      if (ratio < 0.85) return { triggered: true, impact: -4, confidence: 0.7, summary: `Taker偏向主卖 (${ratio.toFixed(2)})` };
      return null;
    },
  },

  // ========== G7 情绪指标 ==========
  // #191 Crypto Fear & Greed Index
  {
    signalId: 191, group: 'G7', name: '恐惧贪婪指数', category: 'D', halfLife: 1440,
    evaluate: (d) => {
      if (d.fearGreedIndex == null) return null;
      const v = d.fearGreedIndex;
      if (v <= 10) return { triggered: true, impact: 10, confidence: 0.9, summary: `恐慌贪婪指数 ${v} (极度恐惧)，历史级别恐慌→强反转信号` };
      if (v <= 20) return { triggered: true, impact: 8, confidence: 0.85, summary: `恐慌贪婪指数 ${v} (恐惧)，市场恐慌→潜在买入机会` };
      if (v <= 30) return { triggered: true, impact: 5, confidence: 0.75, summary: `恐慌贪婪指数 ${v} (偏恐惧)，情绪低迷` };
      if (v >= 90) return { triggered: true, impact: -10, confidence: 0.9, summary: `恐慌贪婪指数 ${v} (极度贪婪)，历史级别过热→强回调信号` };
      if (v >= 80) return { triggered: true, impact: -8, confidence: 0.85, summary: `恐慌贪婪指数 ${v} (贪婪)，市场过热→注意风险` };
      if (v >= 70) return { triggered: true, impact: -4, confidence: 0.7, summary: `恐慌贪婪指数 ${v} (偏贪婪)，情绪偏热` };
      return null; // 30-70 中性区间不触发
    },
  },
  // #204 BTC Dominance 变化
  {
    signalId: 204, group: 'G7', name: 'BTC占比', category: 'D', halfLife: 720,
    evaluate: (d) => {
      if (d.btcDominance == null) return null;
      const dom = d.btcDominance;
      if (dom > 65) return { triggered: true, impact: -6, confidence: 0.8, summary: `BTC占比极高 ${dom.toFixed(1)}%，避险情绪强/山寨疲软` };
      if (dom > 58) return { triggered: true, impact: -3, confidence: 0.7, summary: `BTC占比偏高 ${dom.toFixed(1)}%，资金流向BTC` };
      if (dom < 40) return { triggered: true, impact: 6, confidence: 0.8, summary: `BTC占比极低 ${dom.toFixed(1)}%，山寨季/风险偏好强` };
      if (dom < 45) return { triggered: true, impact: 3, confidence: 0.7, summary: `BTC占比偏低 ${dom.toFixed(1)}%，资金分散到山寨` };
      return null;
    },
  },
];

// ==================== 数据采集函数 ====================

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBTCFundingRate(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl('/fapi/v1/premiumIndex?symbol=BTCUSDT'));
    return Number(data.lastFundingRate) || null;
  } catch (e: any) {
    console.warn('[HardSignal] BTC funding rate failed:', e.message);
    return null;
  }
}

async function fetchETHFundingRate(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl('/fapi/v1/premiumIndex?symbol=ETHUSDT'));
    return Number(data.lastFundingRate) || null;
  } catch (e: any) {
    console.warn('[HardSignal] ETH funding rate failed:', e.message);
    return null;
  }
}

async function fetchOpenInterest(symbol: string): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl(`/fapi/v1/openInterest?symbol=${symbol}`));
    return Number(data.openInterest) || null;
  } catch (e: any) {
    console.warn(`[HardSignal] ${symbol} OI failed:`, e.message);
    return null;
  }
}

async function fetchLongShortRatio(): Promise<number | null> {
  try {
    // 顶级交易者多空比 (5分钟)
    const data = await fetchWithTimeout(binanceFuturesUrl('/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'));
    if (Array.isArray(data) && data.length > 0) {
      return Number(data[0].longShortRatio) || null;
    }
    return null;
  } catch (e: any) {
    console.warn('[HardSignal] Long/Short ratio failed:', e.message);
    return null;
  }
}

async function fetchTakerBuySellRatio(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl('/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1'));
    if (Array.isArray(data) && data.length > 0) {
      return Number(data[0].buySellRatio) || null;
    }
    return null;
  } catch (e: any) {
    console.warn('[HardSignal] Taker ratio failed:', e.message);
    return null;
  }
}

async function fetchBTCPrice(): Promise<{ price: number; volume: number } | null> {
  try {
    const data = await fetchWithTimeout(binanceSpotUrl('/api/v3/ticker/24hr?symbol=BTCUSDT'));
    return {
      price: Number(data.lastPrice) || 0,
      volume: Number(data.quoteVolume) || 0, // USDT volume
    };
  } catch (e: any) {
    console.warn('[HardSignal] BTC price failed:', e.message);
    return null;
  }
}

async function fetchOrderBookDepth(): Promise<{ bidDepth: number; askDepth: number } | null> {
  try {
    // 获取盘口深度 (limit=500 覆盖约±1%深度)
    const data = await fetchWithTimeout(binanceSpotUrl('/api/v3/depth?symbol=BTCUSDT&limit=500'));
    const bids: [string, string][] = data.bids || [];
    const asks: [string, string][] = data.asks || [];

    if (bids.length === 0 || asks.length === 0) return null;

    const midPrice = (Number(bids[0][0]) + Number(asks[0][0])) / 2;
    const lowerBound = midPrice * 0.99; // -1%
    const upperBound = midPrice * 1.01; // +1%

    let bidDepth = 0;
    for (const [price, qty] of bids) {
      if (Number(price) >= lowerBound) bidDepth += Number(price) * Number(qty);
    }
    let askDepth = 0;
    for (const [price, qty] of asks) {
      if (Number(price) <= upperBound) askDepth += Number(price) * Number(qty);
    }

    return { bidDepth, askDepth };
  } catch (e: any) {
    console.warn('[HardSignal] Order book failed:', e.message);
    return null;
  }
}

async function fetchFearGreedIndex(): Promise<{ value: number; classification: string } | null> {
  try {
    const data = await fetchWithTimeout(alternativeUrl('/fng/?limit=1'));
    const entry = data.data?.[0];
    if (!entry) return null;
    return {
      value: Number(entry.value) || 50,
      classification: entry.value_classification || 'Neutral',
    };
  } catch (e: any) {
    console.warn('[HardSignal] Fear & Greed failed:', e.message);
    return null;
  }
}

async function fetchBTCDominance(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(coingeckoUrl('/api/v3/global'));
    return data.data?.market_cap_percentage?.btc || null;
  } catch (e: any) {
    console.warn('[HardSignal] BTC dominance failed:', e.message);
    return null;
  }
}

// ==================== 主采集函数 ====================
export async function collectHardMarketData(): Promise<HardMarketData> {
  const errors: string[] = [];

  // OI 需要价格换算
  const [
    btcFundingRate, ethFundingRate,
    btcOI_raw, ethOI_raw,
    btcLongShortRatio, btcTakerRatio,
    btcTicker, depth,
    fearGreed, btcDominance,
  ] = await Promise.all([
    fetchBTCFundingRate().catch(e => { errors.push(`BTC FR: ${e.message}`); return null; }),
    fetchETHFundingRate().catch(e => { errors.push(`ETH FR: ${e.message}`); return null; }),
    fetchOpenInterest('BTCUSDT').catch(e => { errors.push(`BTC OI: ${e.message}`); return null; }),
    fetchOpenInterest('ETHUSDT').catch(e => { errors.push(`ETH OI: ${e.message}`); return null; }),
    fetchLongShortRatio().catch(e => { errors.push(`L/S Ratio: ${e.message}`); return null; }),
    fetchTakerBuySellRatio().catch(e => { errors.push(`Taker: ${e.message}`); return null; }),
    fetchBTCPrice().catch(e => { errors.push(`BTC Price: ${e.message}`); return null; }),
    fetchOrderBookDepth().catch(e => { errors.push(`Depth: ${e.message}`); return null; }),
    fetchFearGreedIndex().catch(e => { errors.push(`FGI: ${e.message}`); return null; }),
    fetchBTCDominance().catch(e => { errors.push(`DOM: ${e.message}`); return null; }),
  ]);

  // OI 从合约数量转换为 USDT (OI_raw 是 BTC 数量，需乘以价格)
  const btcPrice = btcTicker?.price || null;
  const btcOpenInterest = (btcOI_raw != null && btcPrice != null) ? btcOI_raw * btcPrice : null;
  // ETH OI 需要 ETH 价格，简化处理暂不转换
  const ethOpenInterest = ethOI_raw; // 原始数量

  return {
    timestamp: Date.now(),
    btcFundingRate,
    ethFundingRate,
    btcOpenInterest,
    ethOpenInterest,
    btcLongShortRatio,
    btcTakerRatio,
    btcPrice,
    btcVolume24h: btcTicker?.volume || null,
    btcBidDepth: depth?.bidDepth || null,
    btcAskDepth: depth?.askDepth || null,
    fearGreedIndex: fearGreed?.value || null,
    fearGreedClass: fearGreed?.classification || null,
    btcDominance,
    errors,
  };
}

// ==================== 硬信号触发 ====================

/**
 * 评估所有硬信号规则，返回触发的 SignalEvent 列表
 */
export function evaluateHardSignals(data: HardMarketData): SignalEvent[] {
  const events: SignalEvent[] = [];
  const now = Date.now();

  for (const rule of HARD_SIGNAL_RULES) {
    try {
      const result = rule.evaluate(data);
      if (result && result.triggered) {
        events.push({
          signalId: rule.signalId,
          group: rule.group,
          impact: result.impact,
          confidence: result.confidence,
          category: rule.category,
          halfLife: rule.halfLife,
          triggeredAt: now,
          title: rule.name,
          summary: result.summary,
          source: 'HARD_DATA',
        });
      }
    } catch (e: any) {
      console.warn(`[HardSignal] Rule #${rule.signalId} eval error:`, e.message);
    }
  }

  return events;
}

/**
 * 一站式: 采集数据 + 评估信号
 * 返回硬信号事件列表和原始市场数据
 */
export async function collectAndEvaluateHardSignals(): Promise<{
  events: SignalEvent[];
  marketData: HardMarketData;
}> {
  const marketData = await collectHardMarketData();
  const events = evaluateHardSignals(marketData);

  if (events.length > 0) {
    console.log(`[HardSignal] ${events.length} signals triggered from ${10 - marketData.errors.length}/10 data sources`);
    for (const e of events) {
      console.log(`  #${e.signalId} ${e.title}: impact=${e.impact} conf=${e.confidence} | ${e.summary}`);
    }
  }
  if (marketData.errors.length > 0) {
    console.warn(`[HardSignal] ${marketData.errors.length} data source errors:`, marketData.errors);
  }

  return { events, marketData };
}

/**
 * 格式化硬数据为简报补充文本
 */
export function formatHardDataSummary(data: HardMarketData): string {
  const lines: string[] = ['## 📡 实时硬数据 (API直连)'];

  if (data.btcPrice != null) {
    lines.push(`BTC价格: $${data.btcPrice.toLocaleString()}`);
  }
  if (data.btcFundingRate != null) {
    lines.push(`BTC资金费率: ${(data.btcFundingRate * 100).toFixed(4)}%`);
  }
  if (data.ethFundingRate != null) {
    lines.push(`ETH资金费率: ${(data.ethFundingRate * 100).toFixed(4)}%`);
  }
  if (data.btcOpenInterest != null) {
    lines.push(`BTC OI: $${(data.btcOpenInterest / 1e9).toFixed(2)}B`);
  }
  if (data.btcLongShortRatio != null) {
    lines.push(`BTC多空比: ${data.btcLongShortRatio.toFixed(2)}`);
  }
  if (data.btcTakerRatio != null) {
    lines.push(`Taker买卖比: ${data.btcTakerRatio.toFixed(2)}`);
  }
  if (data.btcBidDepth != null && data.btcAskDepth != null) {
    lines.push(`盘口深度 (±1%): 买 $${(data.btcBidDepth / 1e6).toFixed(1)}M / 卖 $${(data.btcAskDepth / 1e6).toFixed(1)}M`);
  }
  if (data.fearGreedIndex != null) {
    lines.push(`恐慌贪婪指数: ${data.fearGreedIndex} (${data.fearGreedClass})`);
  }
  if (data.btcDominance != null) {
    lines.push(`BTC市值占比: ${data.btcDominance.toFixed(1)}%`);
  }

  return lines.join('\n');
}
