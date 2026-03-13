/**
 * Sentinel-X LLM Service — Pipeline Edition
 * 三阶段信号分析管线:
 *   Step 0: 免费 API 数据采集 (CryptoCompare/CoinGecko/恐贪指数)
 *   Step 1: Searcher LLM (Perplexity) — 联网搜索实时市场情报
 *   Step 2: Analyzer LLM (DeepSeek/Gemini/GPT) — 深度分析300信号矩阵
 */
import { decrypt } from './crypto';
import type {
  LLMConfig, LLMProvider, LLMRole, SignalDefinition, SignalEvent, EventAlert, AlertLevel, SignalGroup,
  TradeSuggestion,
} from '../types';
import { db } from '../db';
import { SIGNAL_GROUPS } from './sentinelEngine';
import { collectMarketData, formatMarketDataForPrompt, type MarketDataSnapshot } from './marketDataService';
import { getTechnicalSnapshot, formatTechnicalForPrompt } from './technicalAnalysis';

// ==================== LLM Provider 配置 ====================
export const LLM_PROVIDERS: Record<LLMProvider, {
  name: string;
  defaultUrl: string;
  defaultModel: string;
  supportedRoles: LLMRole[];
  description: string;
}> = {
  perplexity: {
    name: 'Perplexity',
    defaultUrl: 'https://api.perplexity.ai/chat/completions',
    defaultModel: 'sonar-pro',
    supportedRoles: ['searcher'],
    description: '联网搜索最强，自动搜索最新网页信息',
  },
  gemini: {
    name: 'Google Gemini',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    defaultModel: 'gemini-2.5-flash',
    supportedRoles: ['searcher', 'analyzer'],
    description: '搜索+推理都强，支持 Google Search 工具',
  },
  openai: {
    name: 'OpenAI',
    defaultUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    supportedRoles: ['analyzer'],
    description: 'GPT-4o 强推理能力',
  },
  anthropic: {
    name: 'Anthropic',
    defaultUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    supportedRoles: ['analyzer'],
    description: 'Claude 深度分析',
  },
  deepseek: {
    name: 'DeepSeek',
    defaultUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    supportedRoles: ['analyzer'],
    description: '性价比高，中文分析能力强',
  },
  custom: {
    name: '自定义 (兼容OpenAI格式)',
    defaultUrl: '',
    defaultModel: '',
    supportedRoles: ['searcher', 'analyzer'],
    description: '自定义 OpenAI 兼容端点',
  },
};

// ==================== Prompt 构建 ====================
function buildSearchPrompt(): string {
  return `你是 Sentinel-X 加密市场情报搜索引擎。请搜索并汇总以下维度的**最新实时信息**（过去24-48小时）：

1. **宏观经济**: 美联储/欧央行利率决议、CPI/非农数据、美元指数走势
2. **监管政策**: 美国SEC/CFTC/各国对加密货币的最新监管动态、ETF审批进展
3. **机构动向**: 大型机构（BlackRock/MicroStrategy/Grayscale等）的加密投资动态、ETF资金流入流出
4. **链上数据**: 交易所BTC/ETH储备变化、巨鲸大额转账、Gas费异常
5. **市场事件**: 重大黑客攻击、交易所事件、稳定币脱锚风险
6. **关键人物言论**: 特朗普/马斯克/赵长鹏/V神等对加密市场的最新言论
7. **叙事热点**: 当前最热的赛道/概念（AI+Crypto、RWA、Meme、Layer2等）
8. **地缘政治**: 影响金融市场的地缘冲突或重大政治事件

## 输出格式
请用中文按以下结构输出，每个条目包含具体事件、时间、来源：

### 1. 宏观经济
- [事件描述] (来源: xxx, 时间: xxx)

### 2. 监管政策
...

（如果某个维度没有重大新闻，注明"暂无重大动态"）

### 市场情绪总结
用100字总结当前整体市场情绪和关键风险点。`;
}

function buildSignalAnalysisPrompt(signals: SignalDefinition[], marketData: string, searchIntel: string): string {
  const grouped = new Map<SignalGroup, SignalDefinition[]>();
  signals.forEach(sig => {
    const list = grouped.get(sig.group) || [];
    list.push(sig);
    grouped.set(sig.group, list);
  });

  let signalList = '';
  for (const groupCfg of SIGNAL_GROUPS) {
    const sigs = grouped.get(groupCfg.id);
    if (!sigs || sigs.length === 0) continue;
    signalList += `\n### ${groupCfg.icon} [${groupCfg.id}] ${groupCfg.label}\n`;
    for (const sig of sigs) {
      signalList += `  #${sig.signalId} | ${sig.name} | 权重=${sig.impact} | 半衰期=${sig.halfLife}min | 归类=${sig.category} | 条件: ${sig.triggerCondition}\n`;
    }
  }

  return `你是 Sentinel-X AI 交易系统的信号分析引擎。你的任务是基于下方提供的**实时市场数据**和**搜索情报**，精确判断300条信号矩阵中哪些正在被触发。

${marketData ? marketData : ''}

${searchIntel ? `## 🔍 联网搜索情报\n${searchIntel}\n` : ''}

## 信号矩阵 (共 ${signals.length} 条)
${signalList}

## 分析指令
1. 结合上方实时数据和搜索情报，逐条评估信号是否被触发
2. 只返回**有实际数据/新闻/事件支持**的信号，不要凭空编造
3. 对每个被触发的信号，给出实际的 impact 值（正数=利多, 负数=利空），取值范围参考原始权重
4. 置信度必须基于数据可靠性: 有确凿数据=1.0, 有可靠新闻=0.8, 合理推断=0.5, 不确定=0.3
5. 如发现致命风险信号（交易所暴雷、稳定币脱锚等），务必在 alerts 中标记 level:"critical"
6. **交易建议**: 基于上方技术分析中提供的**支撑位和阻力位锚点**，给出具体的买卖建议。你**必须从锚点中选择**入场价/目标价/止损价，**禁止自己编造价格**

## 严格按以下 JSON 格式返回：

\`\`\`json
{
  "triggeredSignals": [
    {
      "signalId": <信号编号>,
      "impact": <实际权重值，正或负>,
      "confidence": <0-1 置信度>,
      "title": "<事件标题，20字内>",
      "summary": "<事件摘要与市场影响分析，50-150字>",
      "source": "<信息来源>"
    }
  ],
  "tradeSuggestions": [
    {
      "coin": "<交易对，如 BTCUSDT>",
      "action": "BUY|SELL|HOLD",
      "entryPrice": <入场价，必须来自上方技术分析的支撑位或阻力位>,
      "targetPrice": <目标价，必须来自上方的锚点>,
      "stopLoss": <止损价，必须来自上方的锚点>,
      "confidence": <0-1 信心度，基于信号共振强度>,
      "timeframe": "<建议持仓周期: 1h|4h|1d>",
      "reasoning": "<50-100字，解释为什么选这个锚点入场，哪些信号支持>",
      "anchorSource": "<入场价来自哪个锚点，如 EMA50+FIB_0.618>"
    }
  ],
  "alerts": [
    {
      "title": "<突发事件标题>",
      "description": "<详细描述>",
      "level": "critical|warning|info",
      "group": "<所属组 G1-G10>",
      "signalId": <关联信号编号>,
      "relatedCoins": ["BTC", ...],
      "source": "<来源>"
    }
  ],
  "marketSummary": "<100字整体市场状态概述>"
}
\`\`\`

## 重要
- 没有触发任何信号也是正常的，返回空数组
- impact 正负号代表对加密市场的方向影响（正=利多，负=利空）
- tradeSuggestions: 只在方向明确且有锚点支撑时给出，不确定就返回空数组或 action="HOLD"
- **禁止编造价格**：entryPrice/targetPrice/stopLoss 必须来自技术分析部分提供的支撑位/阻力位/EMA值`;
}

// ==================== Dev Proxy URL 解析 ====================
const isDev = import.meta.env.DEV;

const LLM_PROXY_MAP: Record<string, string> = {
  'https://api.deepseek.com': '/llmapi/deepseek',
  'https://api.openai.com': '/llmapi/openai',
  'https://api.anthropic.com': '/llmapi/anthropic',
  'https://api.perplexity.ai': '/llmapi/perplexity',
  'https://generativelanguage.googleapis.com': '/llmapi/gemini',
};

function resolveApiUrl(originalUrl: string): string {
  if (!isDev) return originalUrl;
  for (const [origin, proxyPath] of Object.entries(LLM_PROXY_MAP)) {
    if (originalUrl.startsWith(origin)) {
      return originalUrl.replace(origin, proxyPath);
    }
  }
  return originalUrl;
}

// ==================== Token 消耗统计 ====================
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
}

// ==================== LLM API 调用 ====================
export async function callLLM(config: LLMConfig, prompt: string): Promise<{ content: string; usage: LLMUsage }> {
  const apiKey = decrypt(config.apiKey);

  const makeUsage = (u: any): LLMUsage => ({
    promptTokens: u?.prompt_tokens || u?.promptTokenCount || u?.input_tokens || 0,
    completionTokens: u?.completion_tokens || u?.candidatesTokenCount || u?.output_tokens || 0,
    totalTokens: u?.total_tokens || (u?.promptTokenCount || 0) + (u?.candidatesTokenCount || 0) || (u?.input_tokens || 0) + (u?.output_tokens || 0) || 0,
    provider: config.provider,
    model: config.model,
  });

  // Gemini — 使用专有 API 格式
  if (config.provider === 'gemini') {
    return callGemini(config, apiKey, prompt);
  }

  // Anthropic — 专有格式
  if (config.provider === 'anthropic') {
    const apiUrl = resolveApiUrl(config.apiUrl);
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return { content: data.content?.[0]?.text || '', usage: makeUsage(data.usage) };
  }

  // OpenAI-compatible (OpenAI, DeepSeek, Perplexity, Custom)
  const apiUrl = resolveApiUrl(config.apiUrl);
  const body: any = {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    messages: [
      { role: 'system', content: '你是 Sentinel-X AI 加密市场信号分析引擎。请始终用中文回复，严格按要求的 JSON 格式输出。只报告有真实事件支持的信号触发。' },
      { role: 'user', content: prompt },
    ],
  };

  // Perplexity 特有参数: 搜索最近24小时
  if (config.provider === 'perplexity') {
    body.search_recency_filter = 'day';
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${config.provider} API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content || '', usage: makeUsage(data.usage) };
}

// ==================== Gemini 调用 ====================
async function callGemini(config: LLMConfig, apiKey: string, prompt: string): Promise<{ content: string; usage: LLMUsage }> {
  // Gemini URL 格式: .../models/{model}:generateContent?key=...
  const baseUrl = config.apiUrl.replace('{model}', config.model);
  const apiUrl = resolveApiUrl(baseUrl);
  const separator = apiUrl.includes('?') ? '&' : '?';
  const fullUrl = `${apiUrl}${separator}key=${apiKey}`;

  const body: any = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxTokens,
    },
  };

  // Gemini searcher 角色 — 启用 Google Search 工具
  if (config.role === 'searcher') {
    body.tools = [{ google_search: {} }];
  }

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }
  const data = await res.json();

  // 提取文本部分
  const parts = data.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p: any) => p.text || '').join('\n');
  const meta = data.usageMetadata || {};
  return {
    content,
    usage: {
      promptTokens: meta.promptTokenCount || 0,
      completionTokens: meta.candidatesTokenCount || 0,
      totalTokens: meta.totalTokenCount || (meta.promptTokenCount || 0) + (meta.candidatesTokenCount || 0),
      provider: config.provider,
      model: config.model,
    },
  };
}

// ==================== JSON 解析 ====================
function extractJSON(text: string): any {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(jsonStr.slice(start, end + 1));
      } catch {
        throw new Error('无法解析 LLM 返回的 JSON 数据');
      }
    }
    throw new Error('LLM 返回的数据不包含有效 JSON');
  }
}

// ==================== Pipeline 进度回调 ====================
export interface PipelineProgress {
  step: number;       // 0=数据采集, 1=联网搜索, 2=信号分析
  totalSteps: number; // 总步数 (2 或 3)
  label: string;
  detail?: string;
}

// ==================== 主分析管线 ====================
export async function analyzeSignals(
  analyzerConfig: LLMConfig,
  signals: SignalDefinition[],
  onProgress?: (p: PipelineProgress) => void,
): Promise<{
  events: SignalEvent[];
  alerts: EventAlert[];
  tradeSuggestions: TradeSuggestion[];
  marketSummary: string;
  pipelineInfo: { hasSearcher: boolean; hasMarketData: boolean; searcherProvider?: string; analyzerProvider: string };
  tokenUsage: LLMUsage[];
}> {
  const enabledSignals = signals.filter(s => s.enabled);
  if (enabledSignals.length === 0) {
    return { events: [], alerts: [], tradeSuggestions: [], marketSummary: '', pipelineInfo: { hasSearcher: false, hasMarketData: false, analyzerProvider: analyzerConfig.provider }, tokenUsage: [] };
  }

  // 查找 searcher LLM
  const searcherConfig = (await db.llmConfigs.filter(c => c.enabled && c.role === 'searcher').toArray())[0] || null;
  const totalSteps = searcherConfig ? 3 : 2;

  // ===== Step 0: 免费 API 数据采集 + 技术分析 =====
  onProgress?.({ step: 0, totalSteps, label: '📡 采集市场数据 + 技术分析', detail: '行情/恐贪指数/RSI/MACD/布林带/支撑阻力位' });
  let marketDataText = '';
  let snapshot: MarketDataSnapshot | null = null;
  try {
    // 并行采集: 基础市场数据 + BTC技术分析
    const [mktData, techSnap] = await Promise.all([
      collectMarketData().catch(e => { console.warn('Market data failed:', e.message); return null; }),
      getTechnicalSnapshot('BTCUSDT').catch(e => { console.warn('Technical analysis failed:', e.message); return null; }),
    ]);
    snapshot = mktData;
    if (mktData) {
      marketDataText = formatMarketDataForPrompt(mktData);
      if (mktData.errors.length > 0) {
        console.warn('Market data partial errors:', mktData.errors);
      }
    }
    // 注入技术分析锚点 (LLM只定性，代码定量)
    if (techSnap) {
      marketDataText += '\n\n' + formatTechnicalForPrompt(techSnap);
      console.log(`[Pipeline] 技术分析完成: ${techSnap.trendBias} | 波动${techSnap.volatilityLevel} | ${techSnap.anchors.length}个锚点`);
    }
  } catch (err: any) {
    console.warn('Data collection failed:', err.message);
  }

  // ===== Step 1: 联网搜索 (如果配置了 searcher) =====
  let searchIntel = '';
  const usageList: LLMUsage[] = [];
  if (searcherConfig) {
    onProgress?.({ step: 1, totalSteps, label: '🔍 联网搜索实时情报', detail: `${LLM_PROVIDERS[searcherConfig.provider]?.name || searcherConfig.provider} 搜索中...` });
    try {
      const searchResult = await callLLM(searcherConfig, buildSearchPrompt());
      searchIntel = searchResult.content;
      usageList.push(searchResult.usage);
    } catch (err: any) {
      console.warn('Search LLM failed:', err.message);
      searchIntel = `[搜索失败: ${err.message}]`;
    }
  }

  // ===== Step 2: 深度信号分析 =====
  const analyzeStep = searcherConfig ? 2 : 1;
  onProgress?.({ step: analyzeStep, totalSteps, label: '🧠 分析300条信号矩阵', detail: `${LLM_PROVIDERS[analyzerConfig.provider]?.name || analyzerConfig.provider} 分析中...` });

  const prompt = buildSignalAnalysisPrompt(enabledSignals, marketDataText, searchIntel);
  const analyzeResult = await callLLM(analyzerConfig, prompt);
  usageList.push(analyzeResult.usage);
  const parsed = extractJSON(analyzeResult.content);

  const now = Date.now();

  // 构建 signalId → SignalDefinition 映射
  const sigMap = new Map<number, SignalDefinition>();
  enabledSignals.forEach(s => sigMap.set(s.signalId, s));

  const events: SignalEvent[] = (parsed.triggeredSignals || []).map((t: any) => {
    const def = sigMap.get(t.signalId);
    return {
      signalId: t.signalId,
      group: def?.group || 'G1',
      category: def?.category || 'D',
      impact: Number(t.impact) || 0,
      confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0.5)),
      halfLife: def?.halfLife || 720,
      title: t.title || '无标题',
      summary: t.summary || '',
      source: t.source || 'LLM分析',
      triggeredAt: now,
    };
  }).filter((e: SignalEvent) => e.impact !== 0);

  const alerts: EventAlert[] = (parsed.alerts || []).map((a: any) => ({
    title: a.title || '未知事件',
    description: a.description || '',
    level: (['critical', 'warning', 'info'].includes(a.level) ? a.level : 'info') as AlertLevel,
    group: (a.group || 'G9') as SignalGroup,
    signalId: Number(a.signalId) || undefined,
    relatedCoins: Array.isArray(a.relatedCoins) ? a.relatedCoins : [],
    source: a.source || 'LLM分析',
    notified: false,
    notifyChannels: [],
    createdAt: now,
  }));

  // 解析交易建议 (LLM从锚点中选价格)
  const tradeSuggestions: TradeSuggestion[] = (parsed.tradeSuggestions || []).map((s: any) => {
    const action = (['BUY', 'SELL', 'HOLD', 'CLOSE'].includes(s.action) ? s.action : 'HOLD') as TradeSuggestion['action'];
    return {
      coin: s.coin || 'BTCUSDT',
      action,
      entryPrice: Number(s.entryPrice) || 0,
      targetPrice: Number(s.targetPrice) || 0,
      stopLoss: Number(s.stopLoss) || 0,
      confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
      timeframe: s.timeframe || '4h',
      reasoning: s.reasoning || '',
      anchorSource: s.anchorSource || '',
    };
  }).filter((s: TradeSuggestion) => s.action !== 'HOLD' && s.entryPrice > 0);

  if (tradeSuggestions.length > 0) {
    console.log(`[Pipeline] LLM 给出 ${tradeSuggestions.length} 条交易建议`);
    for (const s of tradeSuggestions) {
      console.log(`  ${s.action} ${s.coin} @ $${s.entryPrice} → $${s.targetPrice} | SL $${s.stopLoss} | 信心${(s.confidence * 100).toFixed(0)}% | ${s.anchorSource}`);
    }
  }

  return {
    events,
    alerts,
    tradeSuggestions,
    marketSummary: parsed.marketSummary || '',
    pipelineInfo: {
      hasSearcher: !!searcherConfig,
      hasMarketData: !!snapshot && (snapshot.news.length > 0 || snapshot.prices.length > 0),
      searcherProvider: searcherConfig?.provider,
      analyzerProvider: analyzerConfig.provider,
    },
    tokenUsage: usageList,
  };
}

// ==================== 存储结果 (合并硬信号) ====================
export async function saveSignalEvents(softEvents: SignalEvent[], alerts: EventAlert[]) {
  // 采集硬信号并与 LLM 软信号合并
  let hardEvents: SignalEvent[] = [];
  try {
    const { collectAndEvaluateHardSignals } = await import('./hardSignalEngine');
    const { events: hEvents } = await collectAndEvaluateHardSignals();
    hardEvents = hEvents;
    if (hardEvents.length > 0) {
      console.log(`[saveSignalEvents] 硬信号: ${hardEvents.length} 条, 软信号: ${softEvents.length} 条`);
    }
  } catch (e: any) {
    console.warn('[saveSignalEvents] 硬信号采集失败:', e.message);
  }

  // 同一 signalId 硬信号优先 (API数据比LLM判断更可靠)
  const hardIds = new Set(hardEvents.map(e => e.signalId));
  const mergedEvents = [
    ...hardEvents,
    ...softEvents.filter(e => !hardIds.has(e.signalId)),
  ];

  if (mergedEvents.length > 0) {
    await db.signalEvents.bulkAdd(mergedEvents);
  }
  if (alerts.length > 0) {
    await db.eventAlerts.bulkAdd(alerts);
  }
}

// ==================== 获取活跃 LLM 配置 ====================
export async function getActiveLLMConfig(): Promise<LLMConfig | null> {
  const configs = await db.llmConfigs.filter(c => c.enabled).toArray();
  return configs[0] || null;
}
