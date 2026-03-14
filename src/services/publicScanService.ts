/**
 * Public Scan Service — 公共服务模式
 * 连接你搭建的公共扫描服务器，通过 SSE 实时接收简报推送，
 * 也支持手动请求一次扫描和轮询获取最新简报。
 *
 * 服务端 API 协议:
 *   POST /api/scan/request     — 请求立即执行一次扫描 (返回 briefingId)
 *   GET  /api/scan/briefings   — 获取最新简报列表
 *   GET  /api/scan/stream      — SSE 流，实时推送新简报
 *   GET  /api/scan/status      — 服务状态 (健康检查)
 */
import { decrypt } from './crypto';
import { db } from '../db';
import { getLang, getLocale } from './langUtil';
import type {
  PublicServiceConfig, ScanBriefing, ScanMode,
  SignalEvent, EventAlert, AlertLevel, SignalGroup,
} from '../types';
import { notifyAlert } from './notificationService';
import { collectAndEvaluateHardSignals } from './hardSignalEngine';

const isDev = import.meta.env.DEV;

// ==================== Proxy 解析 ====================
function resolveServiceUrl(serverUrl: string, path: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  const fullUrl = `${base}${path}`;
  if (!isDev) return fullUrl;
  // dev 模式走 Vite proxy
  try {
    const url = new URL(fullUrl);
    return `/scanapi${url.pathname}${url.search}`;
  } catch {
    return fullUrl;
  }
}

// ==================== 获取活跃的公共服务配置 ====================
export async function getActivePublicConfig(): Promise<PublicServiceConfig | null> {
  const configs = await db.publicServiceConfigs.filter(c => c.enabled).toArray();
  return configs[0] || null;
}

// ==================== 健康检查 ====================
export async function checkServiceStatus(config: PublicServiceConfig): Promise<{
  ok: boolean;
  version?: string;
  message?: string;
  nextScanAt?: number;
}> {
  const token = decrypt(config.authToken);
  const url = resolveServiceUrl(config.serverUrl, '/api/scan/status');
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, message: `服务器返回 ${res.status}: ${text}` };
    }
    const json = await res.json();
    const d = json.data || json;
    return { ok: d.ok !== false, version: d.version, message: d.message, nextScanAt: d.nextScanAt };
  } catch (err: any) {
    return { ok: false, message: `连接失败: ${err.message}` };
  }
}

// ==================== 请求立即扫描 ====================
export async function requestScan(config: PublicServiceConfig): Promise<{
  briefingId: string;
  estimatedSeconds: number;
}> {
  const token = decrypt(config.authToken);
  const url = resolveServiceUrl(config.serverUrl, '/api/scan/request');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ enableSearch: config.enableSearch ?? true }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`扫描请求失败 ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '扫描请求失败');
  return json.data;
}

// ==================== 拉取最新简报 ====================
export async function fetchLatestBriefings(config: PublicServiceConfig, limit = 5): Promise<ScanBriefing[]> {
  const token = decrypt(config.authToken);
  const url = resolveServiceUrl(config.serverUrl, `/api/scan/briefings?limit=${limit}`);
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`获取简报失败 ${res.status}: ${text}`);
  }
  const json = await res.json();
  const list = json.data || json.briefings || [];
  return (Array.isArray(list) ? list : []).map((b: any) => parseBriefing(b));
}

// ==================== SSE 实时流 ====================
let activeEventSource: EventSource | null = null;

export function connectSSE(
  config: PublicServiceConfig,
  onBriefing: (briefing: ScanBriefing) => void,
  onStatus?: (status: { connected: boolean; message?: string }) => void,
): () => void {
  // 关闭旧连接
  disconnectSSE();

  const token = decrypt(config.authToken);
  const url = resolveServiceUrl(config.serverUrl, `/api/scan/stream?token=${encodeURIComponent(token)}`);

  onStatus?.({ connected: false, message: '正在连接...' });

  const es = new EventSource(url);
  activeEventSource = es;

  es.onopen = () => {
    onStatus?.({ connected: true, message: '已连接' });
    // 更新最后连接时间
    if (config.id) {
      db.publicServiceConfigs.update(config.id, { lastConnectedAt: Date.now() }).catch(() => {});
    }
  };

  es.addEventListener('briefing', (event) => {
    try {
      const data = JSON.parse(event.data);
      const briefing = parseBriefing(data);
      onBriefing(briefing);
    } catch (err) {
      console.warn('Failed to parse SSE briefing:', err);
    }
  });

  es.addEventListener('heartbeat', () => {
    // 服务器心跳, 保持连接
  });

  es.onerror = () => {
    onStatus?.({ connected: false, message: '连接断开，将自动重连...' });
    // EventSource 会自动重连
  };

  // 返回断开函数
  return () => disconnectSSE();
}

export function disconnectSSE() {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
}

// ==================== 解析简报 ====================
function parseBriefing(raw: any): ScanBriefing {
  return {
    briefingId: raw.briefingId || raw.id || `brief-${Date.now()}`,
    mode: 'public-service' as ScanMode,
    timestamp: raw.timestamp || Date.now(),
    receivedAt: Date.now(),
    marketSummary: raw.marketSummary || '',
    marketSummaryEn: raw.marketSummaryEn || '',
    triggeredSignals: (raw.triggeredSignals || []).map((s: any) => ({
      signalId: Number(s.signalId) || 0,
      impact: Number(s.impact) || 0,
      confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
      title: s.title || '无标题',
      titleEn: s.titleEn || '',
      summary: s.summary || '',
      summaryEn: s.summaryEn || '',
      source: s.source || 'Public Service',
    })),
    alerts: (raw.alerts || []).map((a: any) => ({
      title: a.title || '未知事件',
      titleEn: a.titleEn || '',
      description: a.description || '',
      descriptionEn: a.descriptionEn || '',
      level: (['critical', 'warning', 'info'].includes(a.level) ? a.level : 'info') as AlertLevel,
      group: a.group || 'G9',
      relatedCoins: Array.isArray(a.relatedCoins) ? a.relatedCoins : [],
      source: a.source || 'Public Service',
    })),
    pipelineInfo: {
      hasSearcher: raw.pipelineInfo?.hasSearcher ?? true,
      hasMarketData: raw.pipelineInfo?.hasMarketData ?? true,
      searcherProvider: raw.pipelineInfo?.searcherProvider,
      analyzerProvider: raw.pipelineInfo?.analyzerProvider || 'server',
      dataTimestamp: raw.pipelineInfo?.dataTimestamp,
    },
    serverTokenUsage: raw.serverTokenUsage ? {
      searchTokens: raw.serverTokenUsage.searchTokens || 0,
      analyzeTokens: raw.serverTokenUsage.analyzeTokens || 0,
      totalTokens: raw.serverTokenUsage.totalTokens || 0,
    } : undefined,
    startedAt: raw.startedAt || undefined,
    completedAt: raw.completedAt || undefined,
    enableSearch: raw.enableSearch,
    tokenCost: raw.tokenCost,
    notified: false,
  };
}

// ==================== 保存简报 & 转换为系统事件 ====================
export async function saveBriefing(briefing: ScanBriefing, overrideTimestamp?: number): Promise<{
  events: SignalEvent[];
  alerts: EventAlert[];
}> {
  // 简报去重: 如果同 briefingId 已存在则不重复存简报，但信号事件仍然创建
  const existing = await db.scanBriefings.where('briefingId').equals(briefing.briefingId).first();
  if (!existing) {
    await db.scanBriefings.add(briefing);
  }

  const now = overrideTimestamp || Date.now();

  // 转换 LLM 软信号为 SignalEvent
  const signalDefs = await db.signalDefinitions.toArray();
  const defMap = new Map(signalDefs.map(s => [s.signalId, s]));

  const softEvents: SignalEvent[] = briefing.triggeredSignals.map(t => {
    const def = defMap.get(t.signalId);
    return {
      signalId: t.signalId,
      group: (def?.group || 'G1') as SignalGroup,
      category: def?.category || 'D',
      impact: t.impact,
      confidence: t.confidence,
      halfLife: def?.halfLife || 720,
      title: t.title,
      summary: t.summary,
      source: `[公共服务] ${t.source}`,
      triggeredAt: now,
    };
  }).filter(e => e.impact !== 0);

  // 采集硬信号 (API直连数据，毫秒级)
  let hardEvents: SignalEvent[] = [];
  try {
    const { events: hEvents } = await collectAndEvaluateHardSignals();
    hardEvents = hEvents;
    console.log(`[saveBriefing] 硬信号: ${hardEvents.length} 条, 软信号: ${softEvents.length} 条`);
  } catch (e: any) {
    console.warn('[saveBriefing] 硬信号采集失败，仅用LLM软信号:', e.message);
  }

  // 合并: 同一 signalId 硬信号优先 (数据更可靠)
  const hardSignalIds = new Set(hardEvents.map(e => e.signalId));
  const mergedEvents = [
    ...hardEvents,
    ...softEvents.filter(e => !hardSignalIds.has(e.signalId)),
  ];

  const alerts: EventAlert[] = briefing.alerts.map(a => ({
    title: a.title,
    titleEn: a.titleEn || '',
    description: a.description,
    descriptionEn: a.descriptionEn || '',
    level: a.level as AlertLevel,
    group: (a.group || 'G9') as SignalGroup,
    relatedCoins: a.relatedCoins,
    source: `[公共服务] ${a.source}`,
    notified: false,
    notifyChannels: [],
    createdAt: now,
  }));

  // 存入 DB
  if (mergedEvents.length > 0) await db.signalEvents.bulkAdd(mergedEvents);
  if (alerts.length > 0) await db.eventAlerts.bulkAdd(alerts);

  return { events: mergedEvents, alerts };
}

// ==================== 自动通知 ====================
export async function notifyBriefing(briefing: ScanBriefing): Promise<void> {
  // 把简报中的 alerts 推送到用户配置的通知渠道
  for (const alert of briefing.alerts) {
    const eventAlert: EventAlert = {
      title: alert.title,
      description: alert.description,
      level: alert.level as AlertLevel,
      group: (alert.group || 'G9') as SignalGroup,
      relatedCoins: alert.relatedCoins,
      source: `[公共服务] ${alert.source}`,
      notified: false,
      notifyChannels: [],
      createdAt: Date.now(),
    };
    try {
      await notifyAlert(eventAlert);
    } catch (err) {
      console.warn('Notify briefing alert failed:', err);
    }
  }

  // 标记简报为已通知
  if (briefing.id) {
    await db.scanBriefings.update(briefing.id, { notified: true });
  }
}

// ==================== 格式化简报为通知消息 ====================
export function formatBriefingMessage(briefing: ScanBriefing): string {
  const isZh = getLang() === 'zh';
  const time = new Date(briefing.timestamp).toLocaleString(getLocale(), { timeZone: 'Asia/Shanghai' });
  let msg = `🛡️ <b>[${isZh ? 'Sentinel-X 扫描简报' : 'Sentinel-X Scan Briefing'}]</b>\n\n`;
  msg += `⏰ ${time}\n\n`;

  if (briefing.marketSummary) {
    const mktText = isZh ? briefing.marketSummary : (briefing.marketSummaryEn || briefing.marketSummary);
    msg += `📊 <b>${isZh ? '市场概述' : 'Market Summary'}</b>\n${mktText}\n\n`;
  }

  if (briefing.triggeredSignals.length > 0) {
    msg += `⚡ <b>${isZh ? '触发信号' : 'Triggered Signals'} (${briefing.triggeredSignals.length})</b>\n`;
    for (const sig of briefing.triggeredSignals.slice(0, 10)) {
      const arrow = sig.impact > 0 ? '📈' : '📉';
      const sigTitle = isZh ? sig.title : (sig.titleEn || sig.title);
      msg += `${arrow} #${sig.signalId} ${sigTitle} (${sig.impact > 0 ? '+' : ''}${sig.impact})\n`;
    }
    if (briefing.triggeredSignals.length > 10) {
      msg += `...${isZh ? '还有' : 'and'} ${briefing.triggeredSignals.length - 10} ${isZh ? '条' : 'more'}\n`;
    }
    msg += '\n';
  }

  if (briefing.alerts.length > 0) {
    msg += `🚨 <b>${isZh ? '预警' : 'Alerts'} (${briefing.alerts.length})</b>\n`;
    for (const alert of briefing.alerts) {
      const emoji = alert.level === 'critical' ? '🔴' : alert.level === 'warning' ? '🟡' : '🔵';
      const alertTitle = isZh ? alert.title : (alert.titleEn || alert.title);
      msg += `${emoji} ${alertTitle}\n`;
    }
  }

  return msg;
}
