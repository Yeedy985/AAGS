/**
 * Strategy Plaza Service — 策略广场 API 通信层
 * 所有请求发往 alphinel.com 后端
 */
import { db } from '../db';
import { decrypt } from './crypto';

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

// Web 环境下将 alphinel.com 请求走 /scanapi 代理，Electron 直连
function resolveUrl(serverUrl: string, path: string): string {
  const base = serverUrl.replace(/\/$/, '');
  if (!isElectron && (base === 'https://alphinel.com' || base === 'https://www.alphinel.com')) {
    return `${window.location.origin}/scanapi${path}`;
  }
  return `${base}${path}`;
}

export interface PlazaStrategyItem {
  shareCode: string;
  nickname: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  strategyName: string;
  pnlUsdt: number;
  pnlPercent: number;
  runSeconds: number;
  matchCount: number;
  totalGrids: number;
  maxDrawdownPct: number;
  minInvestUsdt: number;
  chartPoints: number[];
  isRunning: boolean;
  copyCount: number;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface PlazaStrategyDetail extends PlazaStrategyItem {
  gridConfig: any;
}

export interface PlazaListResponse {
  items: PlazaStrategyItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 获取公共服务配置 (serverUrl + authToken)
async function getServiceConfig(): Promise<{ serverUrl: string; authToken: string } | null> {
  const configs = await db.publicServiceConfigs.toArray();
  const cfg = configs.find(c => c.enabled);
  if (!cfg) return null;
  try {
    const token = decrypt(cfg.authToken);
    return { serverUrl: cfg.serverUrl.replace(/\/$/, ''), authToken: token };
  } catch {
    return null;
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<{ success: boolean; data?: T; error?: string }> {
  const cfg = await getServiceConfig();
  if (!cfg) throw new Error('未配置公共服务，请先在舆情监控页面配置 AlphaSentinel 服务');

  const url = resolveUrl(cfg.serverUrl, path);
  console.error('[Plaza API] >>>', options.method || 'GET', url, 'token:', cfg.authToken.slice(0, 10) + '...');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.authToken}`,
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  console.error('[Plaza API] <<<', res.status, text.slice(0, 500));
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[Plaza API] JSON parse failed:', e, 'raw:', text);
    throw new Error(`服务器返回非 JSON 响应 (${res.status}): ${text.slice(0, 300)}`);
  }
}

// 公开请求 (无需 auth)
async function publicRequest<T>(path: string, options: RequestInit = {}): Promise<{ success: boolean; data?: T; error?: string }> {
  const cfg = await getServiceConfig();
  // 即使没有 auth，仍需要 serverUrl
  const serverUrl = cfg?.serverUrl || 'https://alphinel.com';
  const url = resolveUrl(serverUrl, path);

  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> || {}) } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`服务器返回非 JSON 响应 (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ── 策略广场列表 (公开) ──
export async function fetchPlazaStrategies(params: {
  page?: number;
  pageSize?: number;
  sort?: 'pnl' | 'copies' | 'newest' | 'runtime';
  symbol?: string;
  minRunDays?: number;
  minPnlPercent?: number;
  maxPnlPercent?: number;
} = {}): Promise<PlazaListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.sort) query.set('sort', params.sort);
  if (params.symbol) query.set('symbol', params.symbol);
  if (params.minRunDays) query.set('minRunDays', String(params.minRunDays));
  if (params.minPnlPercent !== undefined) query.set('minPnlPercent', String(params.minPnlPercent));
  if (params.maxPnlPercent !== undefined) query.set('maxPnlPercent', String(params.maxPnlPercent));

  const qs = query.toString();
  const res = await publicRequest<PlazaListResponse>(`/api/strategy/plaza${qs ? '?' + qs : ''}`);
  if (!res.success) throw new Error(res.error || '获取策略广场失败');
  return res.data!;
}

// ── 策略详情 (公开, 含 gridConfig) ──
export async function fetchPlazaStrategyDetail(shareCode: string): Promise<PlazaStrategyDetail> {
  const res = await publicRequest<PlazaStrategyDetail>(`/api/strategy/${shareCode}`);
  if (!res.success) throw new Error(res.error || '获取策略详情失败');
  return res.data!;
}

// ── 分享策略 (需登录) ──
export async function shareStrategy(data: {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  strategyName: string;
  nickname?: string;
  gridConfig: any;
  pnlUsdt?: number;
  pnlPercent?: number;
  runSeconds?: number;
  matchCount?: number;
  totalGrids?: number;
  maxDrawdownPct?: number;
  minInvestUsdt?: number;
  chartPoints?: number[];
  isRunning?: boolean;
}): Promise<{ shareCode: string; id: number }> {
  const bodyStr = JSON.stringify(data);
  console.log('[Plaza Share] body length:', bodyStr.length, 'preview:', bodyStr.slice(0, 200));
  const res = await apiRequest<{ shareCode: string; id: number }>('/api/strategy/share', {
    method: 'POST',
    body: bodyStr,
  });
  if (!res.success) throw new Error(res.error || '分享失败');
  return res.data!;
}

// ── 同步收益数据 (需登录) ──
export async function syncStrategyData(shareCode: string, data: {
  pnlUsdt?: number;
  pnlPercent?: number;
  runSeconds?: number;
  matchCount?: number;
  totalGrids?: number;
  maxDrawdownPct?: number;
  chartPoints?: number[];
  isRunning?: boolean;
}): Promise<void> {
  const res = await apiRequest(`/api/strategy/${shareCode}/sync`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res.success) throw new Error(res.error || '同步失败');
}

// ── 取消分享 (需登录) ──
export async function unshareStrategy(shareCode: string): Promise<void> {
  const res = await apiRequest(`/api/strategy/${shareCode}`, { method: 'DELETE' });
  if (!res.success) throw new Error(res.error || '取消分享失败');
}

// ── 心跳 (需登录) ──
export async function sendHeartbeat(shareCode: string): Promise<void> {
  try {
    await apiRequest(`/api/strategy/${shareCode}/heartbeat`, { method: 'POST' });
  } catch {
    // 心跳失败不影响策略运行
  }
}

// ── 记录复制 (公开) ──
export async function recordCopy(shareCode: string): Promise<void> {
  await publicRequest(`/api/strategy/${shareCode}/copy`, { method: 'POST' });
}
