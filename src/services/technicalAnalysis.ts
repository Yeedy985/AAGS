/**
 * Technical Analysis Module — V3 技术分析计算引擎
 * 
 * 纯计算模块，不依赖 LLM。输入 K 线数据，输出技术指标 + 支撑阻力位。
 * 
 * 指标:
 * - RSI (14)
 * - MACD (12, 26, 9)
 * - 布林带 (20, 2)
 * - EMA (20, 50, 200)
 * - ATR (14)
 * - 成交量变化率
 * 
 * 锚点 (给 LLM 用):
 * - 静态锚点: 24h/72h 最高最低
 * - 动态锚点: EMA 20/50/200
 * - 斐波那契回撤位
 * 
 * 设计原则: "LLM只定性，代码定量"
 */

// ==================== 类型定义 ====================

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;       // 成交量 (base asset)
  quoteVolume: number;  // 成交额 (quote asset, e.g. USDT)
  closeTime: number;
  trades: number;       // 成交笔数
}

export interface TechnicalIndicators {
  symbol: string;
  timeframe: string;   // '5m' | '15m' | '1h' | '4h' | '1d'
  timestamp: number;
  price: number;

  // 趋势指标
  ema20: number;
  ema50: number;
  ema200: number;
  emaTrend: 'STRONG_UP' | 'UP' | 'NEUTRAL' | 'DOWN' | 'STRONG_DOWN';

  // RSI
  rsi14: number;
  rsiZone: 'OVERBOUGHT' | 'HIGH' | 'NEUTRAL' | 'LOW' | 'OVERSOLD';

  // MACD
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  macdCross: 'GOLDEN_CROSS' | 'DEATH_CROSS' | 'NONE';

  // 布林带
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  bollingerWidth: number;     // 带宽 (波动率)
  bollingerPosition: number;  // 价格在布林带中的位置 0=下轨 1=上轨

  // ATR (波动率)
  atr14: number;
  atrPercent: number;  // ATR / price * 100

  // 成交量
  volumeChange: number;    // 最近5根 vs 前20根 成交量变化率
  volumeTrend: 'SURGE' | 'HIGH' | 'NORMAL' | 'LOW' | 'DRY';
}

export interface PriceAnchor {
  price: number;
  type: 'support' | 'resistance';
  source: string;       // 'EMA20' | 'EMA50' | 'EMA200' | '24H_LOW' | '72H_LOW' | 'FIB_0.382' | etc
  strength: number;     // 0-1, 多个锚点重合时强度更高
}

export interface TechnicalSnapshot {
  symbol: string;
  timestamp: number;
  price: number;

  // 多时间框架指标
  tf5m?: TechnicalIndicators;
  tf15m?: TechnicalIndicators;
  tf1h?: TechnicalIndicators;
  tf4h?: TechnicalIndicators;
  tf1d?: TechnicalIndicators;

  // 汇总锚点 (所有时间框架合并去重)
  anchors: PriceAnchor[];

  // 综合判断
  trendBias: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
  volatilityLevel: 'EXTREME' | 'HIGH' | 'NORMAL' | 'LOW';
}

// ==================== K 线获取 (Binance API) ====================

const _isElectronTA = typeof window !== 'undefined' && !!(window as any).electronAPI;
const _useProxyTA = import.meta.env.DEV || !_isElectronTA;

function binanceSpotUrl(path: string): string {
  return _useProxyTA ? `/proxy/binance${path}` : `https://api.binance.com${path}`;
}

/**
 * 从 Binance 获取 K 线数据
 * @param symbol 交易对 e.g. 'BTCUSDT'
 * @param interval K线周期 e.g. '5m', '15m', '1h', '4h', '1d'
 * @param limit 数量 (最大1000)
 */
export async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<Kline[]> {
  const url = binanceSpotUrl(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Binance klines ${res.status}`);
  const data = await res.json();

  return data.map((k: any[]) => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
    quoteVolume: Number(k[7]),
    trades: Number(k[8]),
  }));
}

// ==================== 基础计算工具 ====================

/** 指数移动平均 EMA */
function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length === 0) return ema;

  const k = 2 / (period + 1);
  ema[0] = data[0]; // 第一个值用SMA初始化

  // 先用SMA算初始值
  if (data.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i];
    ema[0] = sum / period;
    for (let i = 1; i < period; i++) ema[i] = ema[0]; // 填充
    for (let i = period; i < data.length; i++) {
      ema[i] = data[i] * k + ema[i - 1] * (1 - k);
    }
  } else {
    for (let i = 1; i < data.length; i++) {
      ema[i] = data[i] * k + ema[i - 1] * (1 - k);
    }
  }

  return ema;
}

/** 简单移动平均 SMA */
function calcSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma[i] = NaN;
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      sma[i] = sum / period;
    }
  }
  return sma;
}

/** RSI (Wilder's smoothing) */
function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;

  let avgGain = 0;
  let avgLoss = 0;

  // 初始计算
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  // 后续使用 Wilder 平滑
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

/** MACD (12, 26, 9) */
function calcMACD(closes: number[]): { macdLine: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);

  return { macdLine, signal, histogram };
}

/** 布林带 (20, 2) */
function calcBollinger(closes: number[], period = 20, stdMult = 2): {
  upper: number[]; middle: number[]; lower: number[]; width: number[];
} {
  const middle = calcSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const width: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper[i] = NaN; lower[i] = NaN; width[i] = NaN;
      continue;
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - middle[i]) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper[i] = middle[i] + stdMult * std;
    lower[i] = middle[i] - stdMult * std;
    width[i] = middle[i] > 0 ? (upper[i] - lower[i]) / middle[i] * 100 : 0;
  }

  return { upper, middle, lower, width };
}

/** ATR (Average True Range) */
function calcATR(klines: Kline[], period = 14): number[] {
  const atr: number[] = new Array(klines.length).fill(NaN);
  if (klines.length < 2) return atr;

  const tr: number[] = [klines[0].high - klines[0].low];
  for (let i = 1; i < klines.length; i++) {
    const hl = klines[i].high - klines[i].low;
    const hc = Math.abs(klines[i].high - klines[i - 1].close);
    const lc = Math.abs(klines[i].low - klines[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }

  // Wilder smoothing
  if (tr.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    atr[period - 1] = sum / period;
    for (let i = period; i < tr.length; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }

  return atr;
}

// ==================== 锚点计算 ====================

/** 静态锚点: 最近 N 根K线的最高/最低 */
function calcStaticAnchors(klines: Kline[], label: string): PriceAnchor[] {
  if (klines.length === 0) return [];

  let high = -Infinity, low = Infinity;
  for (const k of klines) {
    if (k.high > high) high = k.high;
    if (k.low < low) low = k.low;
  }

  return [
    { price: low, type: 'support', source: `${label}_LOW`, strength: 0.7 },
    { price: high, type: 'resistance', source: `${label}_HIGH`, strength: 0.7 },
  ];
}

/** EMA 动态锚点 */
function calcEMAAnchorS(price: number, ema20: number, ema50: number, ema200: number): PriceAnchor[] {
  const anchors: PriceAnchor[] = [];

  for (const [value, label, baseStrength] of [
    [ema20, 'EMA20', 0.5],
    [ema50, 'EMA50', 0.7],
    [ema200, 'EMA200', 0.9],
  ] as [number, string, number][]) {
    if (isNaN(value) || value <= 0) continue;
    anchors.push({
      price: value,
      type: value < price ? 'support' : 'resistance',
      source: label,
      strength: baseStrength,
    });
  }

  return anchors;
}

/** 斐波那契回撤锚点 */
function calcFibonacciAnchors(high: number, low: number, currentPrice: number): PriceAnchor[] {
  const diff = high - low;
  if (diff <= 0) return [];

  const levels = [
    { ratio: 0.236, label: 'FIB_0.236' },
    { ratio: 0.382, label: 'FIB_0.382' },
    { ratio: 0.5, label: 'FIB_0.5' },
    { ratio: 0.618, label: 'FIB_0.618' },
    { ratio: 0.786, label: 'FIB_0.786' },
  ];

  return levels.map(l => {
    const price = high - diff * l.ratio;
    return {
      price: Math.round(price * 100) / 100,
      type: price < currentPrice ? 'support' as const : 'resistance' as const,
      source: l.label,
      strength: l.ratio === 0.618 ? 0.85 : l.ratio === 0.5 ? 0.75 : 0.6,
    };
  });
}

/** 合并并去重锚点 (相近价格合并，强度叠加) */
function mergeAnchors(anchors: PriceAnchor[], price: number, mergeThreshold = 0.005): PriceAnchor[] {
  if (anchors.length === 0) return [];

  // 按价格排序
  const sorted = [...anchors].sort((a, b) => a.price - b.price);
  const merged: PriceAnchor[] = [];

  for (const anchor of sorted) {
    const existing = merged.find(m =>
      Math.abs(m.price - anchor.price) / price < mergeThreshold &&
      m.type === anchor.type
    );
    if (existing) {
      // 合并: 取平均价格，叠加强度
      existing.price = (existing.price + anchor.price) / 2;
      existing.strength = Math.min(1, existing.strength + anchor.strength * 0.3);
      existing.source += `+${anchor.source}`;
    } else {
      merged.push({ ...anchor });
    }
  }

  // 按与当前价格的距离排序，取最近的各3个支撑/阻力
  const supports = merged
    .filter(a => a.type === 'support' && a.price < price)
    .sort((a, b) => b.price - a.price) // 最近的支撑在前
    .slice(0, 3);

  const resistances = merged
    .filter(a => a.type === 'resistance' && a.price > price)
    .sort((a, b) => a.price - b.price) // 最近的阻力在前
    .slice(0, 3);

  return [...supports, ...resistances];
}

// ==================== 综合计算 ====================

/**
 * 计算单一时间框架的技术指标
 */
export function calculateIndicators(klines: Kline[], symbol: string, timeframe: string): TechnicalIndicators | null {
  if (klines.length < 50) return null; // 至少需要50根K线

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.quoteVolume);
  const lastIdx = closes.length - 1;
  const price = closes[lastIdx];

  // EMA
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);
  const ema20 = ema20Arr[lastIdx];
  const ema50 = ema50Arr[lastIdx] || ema20;
  const ema200 = ema200Arr[lastIdx] || ema50;

  // EMA 趋势判断
  let emaTrend: TechnicalIndicators['emaTrend'] = 'NEUTRAL';
  if (price > ema20 && ema20 > ema50 && ema50 > ema200) emaTrend = 'STRONG_UP';
  else if (price > ema50) emaTrend = 'UP';
  else if (price < ema20 && ema20 < ema50 && ema50 < ema200) emaTrend = 'STRONG_DOWN';
  else if (price < ema50) emaTrend = 'DOWN';

  // RSI
  const rsiArr = calcRSI(closes, 14);
  const rsi14 = rsiArr[lastIdx] || 50;
  let rsiZone: TechnicalIndicators['rsiZone'] = 'NEUTRAL';
  if (rsi14 >= 80) rsiZone = 'OVERBOUGHT';
  else if (rsi14 >= 65) rsiZone = 'HIGH';
  else if (rsi14 <= 20) rsiZone = 'OVERSOLD';
  else if (rsi14 <= 35) rsiZone = 'LOW';

  // MACD
  const macd = calcMACD(closes);
  const macdLine = macd.macdLine[lastIdx] || 0;
  const macdSignal = macd.signal[lastIdx] || 0;
  const macdHistogram = macd.histogram[lastIdx] || 0;

  // MACD 交叉检测 (最近3根K线内)
  let macdCross: TechnicalIndicators['macdCross'] = 'NONE';
  for (let i = lastIdx; i >= Math.max(0, lastIdx - 2); i--) {
    const prev = i > 0 ? macd.histogram[i - 1] : 0;
    const curr = macd.histogram[i] || 0;
    if (prev <= 0 && curr > 0) { macdCross = 'GOLDEN_CROSS'; break; }
    if (prev >= 0 && curr < 0) { macdCross = 'DEATH_CROSS'; break; }
  }

  // 布林带
  const bb = calcBollinger(closes, 20, 2);
  const bollingerUpper = bb.upper[lastIdx] || price * 1.02;
  const bollingerMiddle = bb.middle[lastIdx] || price;
  const bollingerLower = bb.lower[lastIdx] || price * 0.98;
  const bollingerWidth = bb.width[lastIdx] || 0;
  const bbRange = bollingerUpper - bollingerLower;
  const bollingerPosition = bbRange > 0 ? (price - bollingerLower) / bbRange : 0.5;

  // ATR
  const atrArr = calcATR(klines, 14);
  const atr14 = atrArr[lastIdx] || 0;
  const atrPercent = price > 0 ? (atr14 / price) * 100 : 0;

  // 成交量分析: 最近5根 vs 前20根
  const recentVols = volumes.slice(-5);
  const prevVols = volumes.slice(-25, -5);
  const recentAvg = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
  const prevAvg = prevVols.reduce((a, b) => a + b, 0) / (prevVols.length || 1);
  const volumeChange = prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : 0;

  let volumeTrend: TechnicalIndicators['volumeTrend'] = 'NORMAL';
  if (volumeChange > 2.0) volumeTrend = 'SURGE';
  else if (volumeChange > 0.5) volumeTrend = 'HIGH';
  else if (volumeChange < -0.5) volumeTrend = 'DRY';
  else if (volumeChange < -0.2) volumeTrend = 'LOW';

  return {
    symbol, timeframe, timestamp: Date.now(), price,
    ema20, ema50, ema200, emaTrend,
    rsi14: Math.round(rsi14 * 100) / 100, rsiZone,
    macdLine, macdSignal, macdHistogram, macdCross,
    bollingerUpper, bollingerMiddle, bollingerLower, bollingerWidth, bollingerPosition,
    atr14, atrPercent: Math.round(atrPercent * 1000) / 1000,
    volumeChange: Math.round(volumeChange * 100) / 100, volumeTrend,
  };
}

/**
 * 获取完整技术分析快照 (多时间框架 + 锚点)
 */
export async function getTechnicalSnapshot(symbol = 'BTCUSDT'): Promise<TechnicalSnapshot> {
  // 双时钟周期: 短周期用于进场, 长周期用于方向
  const [klines1h, klines4h, klines1d] = await Promise.all([
    fetchKlines(symbol, '1h', 200).catch(() => []),
    fetchKlines(symbol, '4h', 200).catch(() => []),
    fetchKlines(symbol, '1d', 200).catch(() => []),
  ]);

  const price = klines1h.length > 0 ? klines1h[klines1h.length - 1].close : 0;

  const tf1h = klines1h.length >= 50 ? calculateIndicators(klines1h, symbol, '1h') : undefined;
  const tf4h = klines4h.length >= 50 ? calculateIndicators(klines4h, symbol, '4h') : undefined;
  const tf1d = klines1d.length >= 50 ? calculateIndicators(klines1d, symbol, '1d') : undefined;

  // 收集所有锚点
  const allAnchors: PriceAnchor[] = [];

  // 静态锚点: 24h (最近24根1h), 72h (最近72根1h)
  if (klines1h.length >= 24) {
    allAnchors.push(...calcStaticAnchors(klines1h.slice(-24), '24H'));
  }
  if (klines1h.length >= 72) {
    allAnchors.push(...calcStaticAnchors(klines1h.slice(-72), '72H'));
  }
  // 7天高低
  if (klines1d.length >= 7) {
    allAnchors.push(...calcStaticAnchors(klines1d.slice(-7), '7D'));
  }

  // EMA 动态锚点 (用1h的EMA)
  if (tf1h) {
    allAnchors.push(...calcEMAAnchorS(price, tf1h.ema20, tf1h.ema50, tf1h.ema200));
  }
  // 4h EMA 也加入 (更强的支撑阻力)
  if (tf4h) {
    allAnchors.push(...calcEMAAnchorS(price, tf4h.ema20, tf4h.ema50, tf4h.ema200));
  }

  // 斐波那契 (基于72h最高/最低)
  if (klines1h.length >= 72) {
    const recent72 = klines1h.slice(-72);
    const high72 = Math.max(...recent72.map(k => k.high));
    const low72 = Math.min(...recent72.map(k => k.low));
    allAnchors.push(...calcFibonacciAnchors(high72, low72, price));
  }

  // 布林带锚点
  if (tf1h) {
    allAnchors.push(
      { price: tf1h.bollingerLower, type: 'support', source: 'BB_LOWER_1H', strength: 0.6 },
      { price: tf1h.bollingerUpper, type: 'resistance', source: 'BB_UPPER_1H', strength: 0.6 },
    );
  }

  // 合并去重
  const anchors = mergeAnchors(allAnchors, price);

  // 综合趋势判断 (多时间框架投票)
  const trendBias = calcTrendBias(tf1h, tf4h, tf1d);
  const volatilityLevel = calcVolatilityLevel(tf1h, tf4h);

  return {
    symbol, timestamp: Date.now(), price,
    tf1h: tf1h || undefined,
    tf4h: tf4h || undefined,
    tf1d: tf1d || undefined,
    anchors,
    trendBias,
    volatilityLevel,
  };
}

// ==================== 综合判断 ====================

function calcTrendBias(
  tf1h?: TechnicalIndicators | null,
  tf4h?: TechnicalIndicators | null,
  tf1d?: TechnicalIndicators | null,
): TechnicalSnapshot['trendBias'] {
  let score = 0; // -10 ~ +10

  for (const [tf, weight] of [[tf1h, 1], [tf4h, 2], [tf1d, 3]] as [TechnicalIndicators | null | undefined, number][]) {
    if (!tf) continue;

    // EMA趋势
    if (tf.emaTrend === 'STRONG_UP') score += 2 * weight;
    else if (tf.emaTrend === 'UP') score += 1 * weight;
    else if (tf.emaTrend === 'DOWN') score -= 1 * weight;
    else if (tf.emaTrend === 'STRONG_DOWN') score -= 2 * weight;

    // RSI
    if (tf.rsi14 > 70) score -= 0.5 * weight; // 超买偏空
    else if (tf.rsi14 < 30) score += 0.5 * weight; // 超卖偏多

    // MACD
    if (tf.macdHistogram > 0) score += 0.5 * weight;
    else score -= 0.5 * weight;
  }

  if (score >= 8) return 'STRONG_BULLISH';
  if (score >= 3) return 'BULLISH';
  if (score <= -8) return 'STRONG_BEARISH';
  if (score <= -3) return 'BEARISH';
  return 'NEUTRAL';
}

function calcVolatilityLevel(
  tf1h?: TechnicalIndicators | null,
  tf4h?: TechnicalIndicators | null,
): TechnicalSnapshot['volatilityLevel'] {
  const atr = tf1h?.atrPercent || tf4h?.atrPercent || 0;
  const bbWidth = tf1h?.bollingerWidth || tf4h?.bollingerWidth || 0;

  // BTC日常 ATR% ≈ 1-3%, BB带宽 ≈ 2-5%
  if (atr > 5 || bbWidth > 8) return 'EXTREME';
  if (atr > 3 || bbWidth > 5) return 'HIGH';
  if (atr < 0.8 && bbWidth < 2) return 'LOW';
  return 'NORMAL';
}

// ==================== 格式化为 LLM Prompt 注入文本 ====================

/**
 * 将技术分析结果格式化为 LLM 可理解的文本
 * 这是"锚点注入"的核心 — 把代码算好的数字喂给 LLM
 */
export function formatTechnicalForPrompt(snapshot: TechnicalSnapshot): string {
  const { symbol, price, tf1h, tf4h, tf1d, anchors, trendBias, volatilityLevel } = snapshot;

  let text = `## 📐 ${symbol} 技术分析 (代码计算，非AI推测)\n`;
  text += `当前价格: $${price.toLocaleString()}\n`;
  text += `综合趋势: ${trendBias} | 波动水平: ${volatilityLevel}\n\n`;

  // 多时间框架摘要
  for (const [label, tf] of [['1小时', tf1h], ['4小时', tf4h], ['日线', tf1d]] as [string, TechnicalIndicators | undefined][]) {
    if (!tf) continue;
    text += `### ${label}级别\n`;
    text += `- EMA趋势: ${tf.emaTrend} (EMA20=$${tf.ema20.toFixed(1)} EMA50=$${tf.ema50.toFixed(1)} EMA200=$${tf.ema200.toFixed(1)})\n`;
    text += `- RSI(14): ${tf.rsi14.toFixed(1)} [${tf.rsiZone}]\n`;
    text += `- MACD: ${tf.macdCross !== 'NONE' ? `⚡${tf.macdCross}` : `柱状=${tf.macdHistogram.toFixed(2)}`}\n`;
    text += `- 布林带: 位置${(tf.bollingerPosition * 100).toFixed(0)}% (下$${tf.bollingerLower.toFixed(1)} 中$${tf.bollingerMiddle.toFixed(1)} 上$${tf.bollingerUpper.toFixed(1)}) 带宽${tf.bollingerWidth.toFixed(2)}%\n`;
    text += `- ATR(14): $${tf.atr14.toFixed(1)} (${tf.atrPercent.toFixed(2)}%) | 量能: ${tf.volumeTrend} (${tf.volumeChange > 0 ? '+' : ''}${(tf.volumeChange * 100).toFixed(0)}%)\n\n`;
  }

  // 关键锚点 (这是给LLM选择的"菜单")
  if (anchors.length > 0) {
    text += `### 🎯 关键价格锚点 (你的买卖建议必须基于以下价位)\n`;
    const supports = anchors.filter(a => a.type === 'support');
    const resistances = anchors.filter(a => a.type === 'resistance');

    if (supports.length > 0) {
      text += `支撑位:\n`;
      for (const s of supports) {
        text += `  S: $${s.price.toFixed(1)} [${s.source}] 强度${(s.strength * 100).toFixed(0)}%\n`;
      }
    }
    if (resistances.length > 0) {
      text += `阻力位:\n`;
      for (const r of resistances) {
        text += `  R: $${r.price.toFixed(1)} [${r.source}] 强度${(r.strength * 100).toFixed(0)}%\n`;
      }
    }
  }

  return text;
}
