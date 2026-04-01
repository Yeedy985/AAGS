// ==================== 交易所相关 ====================

export type ExchangeType = 'binance' | 'okx' | 'bybit' | 'gate' | 'bitget' | 'kucoin' | 'huobi' | 'mexc';



export interface ExchangeConfig {

  id: ExchangeType;

  name: string;

  logo: string; // emoji or icon

  baseUrl: string;

  proxyPath: string; // Vite dev proxy path, e.g. '/proxy/binance'

  wsUrl: string;

  apiKeyHeader: string;

  signatureMethod: 'hmac-sha256' | 'hmac-sha256-rsa';

  quoteAssets: string[]; // 主要计价币

  features: string[];

  docUrl: string;

  // API路径映射

  serverTimePath?: string;   // 服务器时间接口路径, e.g. '/api/v3/time'

  serverTimeField?: string;  // 响应中时间戳字段名, e.g. 'serverTime'

  endpoints: {

    exchangeInfo: string;

    ticker24h: string;

    tickerPrice: string;

    klines: string;

    account: string;

    order: string;

    openOrders: string;

    allOrders: string;

    myTrades?: string;

  };

}



// ==================== 账户相关 ====================

export interface ApiConfig {

  id?: number;

  exchange: ExchangeType;

  apiKey: string;

  apiSecret: string; // AES encrypted

  passphrase?: string; // OKX/KuCoin需要, AES encrypted

  label: string;

  createdAt: number;

}



export interface AssetBalance {

  asset: string;

  free: string;

  locked: string;

  usdtValue: number;

}



export interface AccountInfo {

  totalUsdtValue: number;

  balances: AssetBalance[];

  updateTime: number;

}



// ==================== 交易对相关 ====================

export interface SymbolInfo {

  symbol: string;

  baseAsset: string;

  quoteAsset: string;

  pricePrecision: number;

  quantityPrecision: number;

  minNotional: number;

  minQty: number;

  stepSize: string;

  tickSize: string;

}



export interface TickerInfo {

  symbol: string;

  price: string;

  priceChangePercent: string;

  volume: string;

  quoteVolume: string;

}



// ==================== 策略相关 ====================

export type StrategyStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'circuit_break';

export type GridLayer = 'trend' | 'swing' | 'spike';

export type RangeMode = 'fixed' | 'percentage' | 'volatility';

export type ProfitMode = 'fixed_rate' | 'per_grid' | 'distance_increase' | 'trend_increase';

export type ProfitAllocation = 'all_usdt' | 'all_coin' | 'ratio' | 'reinvest' | 'threshold_switch';

export type EndMode = 'hold_coin' | 'hold_usdt' | 'keep_position' | 'force_close';



export interface GridLayerConfig {

  layer: GridLayer;

  enabled: boolean;

  gridCount: number;

  upperPrice: number;

  lowerPrice: number;

  rangeRatio: number; // 本层区间占开仓区间的比例, e.g. 1.0 = 100%

  fundRatio: number; // 0-1, percentage of strategy fund

  profitRate: number; // per grid profit rate %

  profitMode: ProfitMode;

  // fixed_rate config

  fixedProfitRate: number; // 固定利润率 %

  // per_grid config

  perGridMinRate: number; // 每格最小利润率 %

  perGridMaxRate: number; // 每格最大利润率 %

  // distance_increase config

  distBaseRate: number; // 基础利润率 %

  distIncreaseStep: number; // 每格递增 %

  distMaxRate: number; // 最大利润率上限 %

  // trend_increase config

  trendBaseRate: number; // 趋势模式基础利润率 %

  trendBullMultiplier: number; // 多头时乘数

  trendBearMultiplier: number; // 空头时乘数

}



export interface RiskConfig {

  // 极端行情熔断

  circuitBreakEnabled: boolean;

  circuitBreakDropPercent: number; // 5min drop threshold %

  circuitBreakVolumeMultiple: number; // volume spike multiple

  // 单日回撤

  dailyDrawdownEnabled: boolean;

  dailyDrawdownPercent: number;

  // 最大仓位

  maxPositionEnabled: boolean;

  maxPositionPercent: number; // max single asset %

  // 趋势防御

  trendDefenseEnabled: boolean;

  trendDefenseEmaFast: number;

  trendDefenseEmaSlow: number;

}



export interface Strategy {

  id?: number;

  name: string;

  symbol: string;

  baseAsset: string;

  quoteAsset: string;

  status: StrategyStatus;

  // 资金

  totalFund: number; // USDT

  usedFund: number;

  // 区间

  rangeMode: RangeMode;

  upperPrice: number;

  lowerPrice: number;

  centerPrice: number;

  useCurrentPrice?: boolean;

  atrPeriod: number;

  atrMultiplier: number;

  // 三层网格

  layers: GridLayerConfig[];

  // 利润

  profitAllocation: ProfitAllocation;

  profitRatio: number; // for 'ratio' mode

  profitThreshold: number; // for 'threshold_switch' mode

  // 趋势利润

  trendSellAbovePercent: number;

  trendBuyBelowPercent: number;

  // 风控

  risk: RiskConfig;

  // 区间突破

  autoRebalance: boolean;

  rebalanceStepPercent: number;

  // 结束模式

  endMode: EndMode;

  // 统计

  totalProfit: number;

  todayProfit: number;

  totalTrades: number;

  winTrades: number;

  maxDrawdown: number;

  // 时间

  createdAt: number;

  startedAt?: number;

  stoppedAt?: number;

}



// ==================== 网格订单 ====================

export type GridOrderSide = 'buy' | 'sell';

export type GridOrderStatus = 'pending' | 'placed' | 'filled' | 'cancelled' | 'error';



export interface GridOrder {

  id?: number;

  strategyId: number;

  layer: GridLayer;

  gridIndex: number;

  side: GridOrderSide;

  price: number;

  quantity: number;

  filledQuantity: number;

  status: GridOrderStatus;

  targetPrice?: number; // 成交后的反向挂单价格

  profitRate?: number; // 本格利润率 %

  binanceOrderId?: string;

  profit?: number;

  createdAt: number;

  updatedAt: number;

}



// ==================== 交易记录 ====================

export interface TradeRecord {

  id?: number;

  strategyId: number;

  layer: GridLayer;

  gridIndex: number;

  side: GridOrderSide;

  price: number;

  quantity: number;

  quoteAmount: number;

  profit: number;

  fee: number;

  feeAsset: string;

  binanceTradeId: string;

  timestamp: number;

}



// ==================== 净值快照 ====================

export interface EquitySnapshot {

  id?: number;

  strategyId: number;

  totalValue: number;

  coinValue: number;

  usdtValue: number;

  unrealizedPnl: number;

  timestamp: number;

}



// ==================== K线数据 ====================

export interface Kline {

  openTime: number;

  open: number;

  high: number;

  low: number;

  close: number;

  volume: number;

  closeTime: number;

}



// ==================== Sentinel-X 信号评分系统 ====================



// 10 个信号组

export type SignalGroup =

  | 'G1'   // 宏观流动性 (30条)

  | 'G2'   // 政策 - 央行与利率 (35条)

  | 'G3'   // 监管 - 合规与法律 (30条)

  | 'G4'   // 机构资金流 (35条)

  | 'G5'   // 链上物理流 (30条)

  | 'G6'   // 市场结构 (30条)

  | 'G7'   // 情绪指标 (30条)

  | 'G8'   // 叙事与赛道 (20条)

  | 'G9'   // 黑天鹅与安全 (30条)

  | 'G10'; // 关键人物与地缘 (30条)



// 信号归类: D=方向, V=波动, R=风险

export type SignalCategory = 'D' | 'V' | 'R';



export interface SignalGroupConfig {

  id: SignalGroup;

  label: string;

  icon: string;

  description: string;

  range: [number, number]; // 信号 ID 范围, e.g. [1, 30]

}



// 信号定义 (300条信号字典中的一条)

export interface SignalDefinition {

  id?: number;           // DB auto-increment

  signalId: number;      // 信号编号 1-300

  group: SignalGroup;

  name: string;          // 信号名称/描述

  impact: number;        // 原始权重 [-100, +100]

  halfLife: number;      // 半衰期 (分钟)

  confidence: number;    // 信源置信度 [0, 1]

  category: SignalCategory; // D/V/R 归类

  enabled: boolean;

  triggerCondition: string; // 触发条件描述 (如 "CPI超预期")

  positiveDesc: string;    // 正面触发描述

  negativeDesc: string;    // 负面触发描述

}



// 信号事件 (某条信号被触发后的实例)

export interface SignalEvent {

  id?: number;

  signalId: number;        // 对应 SignalDefinition.signalId

  group: SignalGroup;

  category: SignalCategory;

  impact: number;          // 触发时的实际权重 (可正可负)

  confidence: number;

  halfLife: number;

  title: string;           // LLM 生成的事件标题

  titleEn?: string;        // English title

  summary: string;         // LLM 生成的事件摘要

  summaryEn?: string;      // English summary

  source: string;          // 信息来源

  triggeredAt: number;     // 触发时间戳

  decayedScore?: number;   // 当前衰减后得分 (运行时计算)

}



// 评分引擎输出的三大指数

export interface ScoringResult {

  id?: number;

  scoreDirection: number;  // SD: 方向分 [-100, +100], tanh压缩

  scoreVolatility: number; // SV: 波动分 [0, 100]

  scoreRisk: number;       // SR: 风险分 [0, 100]

  activeSignals: number;   // 当前活跃信号数

  timestamp: number;

  // Token 消耗 (自建模式记录真实 API 消耗)

  tokenUsage?: {

    promptTokens: number;

    completionTokens: number;

    totalTokens: number;

    provider: string;

    model: string;

  }[];

  scanMode?: ScanMode;     // 'self-hosted' | 'public-service'

  serverTokenUsage?: {     // 公共服务模式: 服务端真实 LLM Token 消耗

    searchTokens: number;

    analyzeTokens: number;

    totalTokens: number;

  };

  serverStartedAt?: string;   // 服务端扫描开始时间 (ISO)

  serverCompletedAt?: string; // 服务端扫描完成时间 (ISO)

}



// 网格自动调参输出

export interface GridAutoParams {

  spacing: number;         // 步长 %: 1.0 / 1.5 / 2.5

  spacingMode: 'narrow' | 'standard' | 'defensive';

  buyRatio: number;        // 买单比例 0-1

  sellRatio: number;       // 卖单比例 0-1

  skewMode: 'bullish' | 'neutral' | 'bearish';

  circuitBreak: boolean;   // SR > 85 触发熔断

  basedOn: ScoringResult;  // 基于哪次评分

}



export type AlertLevel = 'critical' | 'warning' | 'info';



export interface EventAlert {

  id?: number;

  title: string;

  titleEn?: string;

  description: string;

  descriptionEn?: string;

  level: AlertLevel;

  group: SignalGroup;

  signalId?: number;       // 关联信号编号

  scoreSnapshot?: {        // 触发时的评分快照

    sd: number;

    sv: number;

    sr: number;

  };

  relatedCoins: string[];

  source: string;

  notified: boolean;

  notifyChannels: string[];

  createdAt: number;

  acknowledgedAt?: number;

}



export type LLMProvider = 'openai' | 'anthropic' | 'deepseek' | 'perplexity' | 'gemini' | 'custom';

export type LLMRole = 'searcher' | 'analyzer';



export interface LLMConfig {

  id?: number;

  provider: LLMProvider;

  role: LLMRole;          // searcher=联网搜索, analyzer=信号分析

  apiKey: string;         // AES encrypted

  apiUrl: string;

  model: string;

  maxTokens: number;

  temperature: number;

  enabled: boolean;

}



export interface NotificationConfig {

  id?: number;

  channel: 'telegram' | 'whatsapp';

  enabled: boolean;

  telegramBotToken?: string;

  telegramChatId?: string;

  whatsappApiUrl?: string;

  whatsappApiKey?: string;

  whatsappPhone?: string;

  alertLevels: AlertLevel[];

  pushScanResults: boolean;   // 推送信号300扫描结果

  pushAlerts: boolean;        // 推送预警信息

  quietHoursStart?: string;

  quietHoursEnd?: string;

  createdAt: number;

}



// ==================== 扫描模式 ====================

export type ScanMode = 'self-hosted' | 'public-service';



export type ReportMode = 'realtime' | 'scheduled' | 'manual';

export type BriefingFormat = 'compact' | 'full';



export interface PublicServiceConfig {

  id?: number;

  serverUrl: string;              // 公共服务器地址, e.g. https://sentinel.example.com

  authToken: string;              // AES encrypted 用户认证令牌

  enabled: boolean;

  createdAt: number;

  lastConnectedAt?: number;



  // ── 汇报设置 ──

  reportMode: ReportMode;         // 'realtime'=实时推送, 'scheduled'=定时汇报, 'manual'=手动触发

  scheduledTimes: string[];       // 定时汇报时间, e.g. ['08:00', '20:00'] (24h格式, 用户本地时区)



  // ── 通知同步 ──

  notifyEnabled: boolean;         // 是否同步到社交工具

  notifyLevels: AlertLevel[];     // 推送哪些级别 ['critical','warning','info']

  quietHoursStart: string;        // 静默时段开始, e.g. '23:00'

  quietHoursEnd: string;          // 静默时段结束, e.g. '07:00'

  briefingFormat: BriefingFormat; // 'compact'=精简版, 'full'=完整版



  // ── 扫描偏好 ──

  enableSearch: boolean;          // 是否启用搜索增强 (额外消耗 Token)

}



export interface ScanBriefing {

  id?: number;

  briefingId: string;         // 服务端唯一ID

  mode: ScanMode;             // 来源模式

  timestamp: number;          // 服务端生成时间

  receivedAt: number;         // 客户端接收时间

  marketSummary: string;

  marketSummaryEn?: string;

  triggeredSignals: {

    signalId: number;

    impact: number;

    confidence: number;

    title: string;

    titleEn?: string;

    summary: string;

    summaryEn?: string;

    source: string;

  }[];

  alerts: {

    title: string;

    titleEn?: string;

    description: string;

    descriptionEn?: string;

    level: AlertLevel;

    group: string;

    relatedCoins: string[];

    source: string;

  }[];

  pipelineInfo: {

    hasSearcher: boolean;

    hasMarketData: boolean;

    searcherProvider?: string;

    analyzerProvider: string;

    dataTimestamp?: number;

  };

  serverTokenUsage?: {        // 服务端真实 LLM Token 消耗

    searchTokens: number;

    analyzeTokens: number;

    totalTokens: number;

  };

  startedAt?: string;         // 服务端扫描开始时间 (ISO)

  completedAt?: string;       // 服务端扫描完成时间 (ISO)

  enableSearch?: boolean;     // 是否启用搜索增强

  tokenCost?: number;         // 用户 Token 扣费

  notified: boolean;          // 是否已推送到社交工具

}



// ==================== 交易状态机 (Phase 0.5) ====================



export type TradeState = 'WAITING' | 'PRE_ENTRY' | 'IN_TRADE' | 'EXIT_READY' | 'COOLDOWN';



export interface TradeSuggestion {

  coin: string;

  action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';

  entryPrice: number;

  targetPrice: number;

  stopLoss: number;

  confidence: number;       // 0-1

  timeframe: string;        // '1h' | '4h' | '1d'

  reasoning: string;

  anchorSource: string;     // 基于哪个锚点给出的建议

}



export interface TradeContext {

  id?: number;

  coin: string;              // 交易对 e.g. 'BTCUSDT'

  state: TradeState;

  // 建议信息

  suggestion?: TradeSuggestion;

  // 状态机元数据

  stateEnteredAt: number;    // 进入当前状态的时间戳

  lastEvaluatedAt: number;   // 上次评估时间

  lastSignalHash: string;    // 上次信号组合的hash (用于去噪: 信号没变则不更新)

  // 入场信息 (IN_TRADE 状态下有效)

  entryPrice?: number;

  entryTime?: number;

  targetPrice?: number;

  stopLoss?: number;

  // 退出信息

  exitPrice?: number;

  exitTime?: number;

  exitReason?: 'TARGET_HIT' | 'STOP_LOSS' | 'SIGNAL_REVERSAL' | 'TIMEOUT' | 'MANUAL';

  // 追踪

  peakPrice?: number;        // 持仓期间最高价

  troughPrice?: number;      // 持仓期间最低价

  stateHistory: TradeStateTransition[];

  createdAt: number;

  updatedAt: number;

}



export interface TradeStateTransition {

  from: TradeState;

  to: TradeState;

  reason: string;

  timestamp: number;

  scoreSnapshot?: { sd: number; sv: number; sr: number };

}



// ==================== 系统设置 ====================

export interface AppSettings {

  encryptionKey: string;

  theme: 'dark';

  language: 'zh-CN';

  apiBaseUrl: string;

}

