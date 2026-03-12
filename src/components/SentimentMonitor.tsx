import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Plus, Trash2, Play, Loader2, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Eye, EyeOff, AlertTriangle,
  Settings2, RefreshCw, Shield, Zap, Activity,
  ArrowUpRight, ArrowDownRight, Gauge, Search, Brain,
  Globe, Server, Wifi, Clock, Send, ExternalLink, X, Radio, CalendarClock, Hand, Pause, Timer,
} from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { encrypt, decrypt } from '../services/crypto';
import {
  LLM_PROVIDERS, analyzeSignals, saveSignalEvents,
} from '../services/llmService';
import {
  SIGNAL_GROUPS, SIGNAL_MATRIX, SentinelScoringEngine,
} from '../services/sentinelEngine';
import {
  checkServiceStatus, requestScan, fetchLatestBriefings,
  connectSSE, saveBriefing, notifyBriefing,
} from '../services/publicScanService';
import { notifyScanResult, notifyAlert, notifyScanFailure } from '../services/notificationService';
import type {
  SignalGroup, SignalDefinition, ScoringResult,
  GridAutoParams, LLMProvider, LLMRole, EventAlert,
  ScanMode, ScanBriefing, ReportMode, BriefingFormat,
} from '../types';
import type { PipelineProgress } from '../services/llmService';

// ==================== 子组件: LLM 配置面板 ====================
function LLMConfigPanel() {
  const llmConfigs = useLiveQuery(() => db.llmConfigs.toArray(), []);
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<LLMProvider>('perplexity');
  const [role, setRole] = useState<LLMRole>('searcher');
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [model, setModel] = useState('');
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.3);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleProviderChange = (p: LLMProvider, newRole?: LLMRole) => {
    setProvider(p);
    const cfg = LLM_PROVIDERS[p];
    setApiUrl(cfg.defaultUrl);
    setModel(cfg.defaultModel);
    // 自动选择该 provider 支持的第一个 role（仅在未指定 newRole 时）
    const r = newRole ?? role;
    if (cfg.supportedRoles.length > 0 && !cfg.supportedRoles.includes(r)) {
      setRole(cfg.supportedRoles[0]);
    } else if (newRole) {
      setRole(newRole);
    }
  };

  const handleRoleChange = (r: LLMRole) => {
    setRole(r);
    // 当前 provider 不支持新角色时，自动切换到第一个支持的 provider
    if (!LLM_PROVIDERS[provider].supportedRoles.includes(r)) {
      const fallback = (Object.entries(LLM_PROVIDERS) as [LLMProvider, typeof LLM_PROVIDERS[LLMProvider]][]).find(([, cfg]) => cfg.supportedRoles.includes(r));
      if (fallback) handleProviderChange(fallback[0], r);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      // 同角色的其他配置禁用
      const existing = await db.llmConfigs.toArray();
      for (const c of existing) {
        if (c.id && c.role === role) await db.llmConfigs.update(c.id, { enabled: false });
      }
      await db.llmConfigs.add({
        provider,
        role,
        apiKey: encrypt(apiKey),
        apiUrl: apiUrl || LLM_PROVIDERS[provider].defaultUrl,
        model: model || LLM_PROVIDERS[provider].defaultModel,
        maxTokens,
        temperature,
        enabled: true,
      });
      setApiKey('');
      setShowForm(false);
    } catch (err: any) {
      console.error('保存LLM配置失败:', err);
    }
    setSaving(false);
  };

  const handleDelete = async (id: number) => { await db.llmConfigs.delete(id); };

  const handleToggle = async (id: number, currentRole: LLMRole, enabled: boolean) => {
    if (enabled) {
      // 同角色只能有一个启用
      const all = await db.llmConfigs.toArray();
      for (const c of all) { if (c.id && c.id !== id && c.role === currentRole) await db.llmConfigs.update(c.id, { enabled: false }); }
    }
    await db.llmConfigs.update(id, { enabled });
  };

  const searchers = llmConfigs?.filter(c => c.role === 'searcher') || [];
  const analyzers = llmConfigs?.filter(c => c.role === 'analyzer') || [];

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-end">
        <button className="btn-primary text-sm flex items-center gap-1" onClick={() => { setShowForm(!showForm); if (!showForm) handleProviderChange('perplexity'); }}>
          <Plus className="w-4 h-4" /> 添加
        </button>
      </div>

      {/* 管线说明 */}
      <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full bg-cyan-600/20 text-cyan-400 flex items-center justify-center text-sm font-bold">0</span>
            <span className="text-slate-400">📡 免费数据采集</span>
          </div>
          <span className="text-slate-600">→</span>
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-sm font-bold">1</span>
            <span className="text-slate-400">🔍 搜索 LLM</span>
            <span className="text-slate-600">{searchers.find(s => s.enabled) ? `(${LLM_PROVIDERS[searchers.find(s => s.enabled)!.provider]?.name})` : '(未配置)'}</span>
          </div>
          <span className="text-slate-600">→</span>
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center text-sm font-bold">2</span>
            <span className="text-slate-400">🧠 分析 LLM</span>
            <span className="text-slate-600">{analyzers.find(a => a.enabled) ? `(${LLM_PROVIDERS[analyzers.find(a => a.enabled)!.provider]?.name})` : '(未配置)'}</span>
          </div>
        </div>
        <p className="text-sm text-slate-600 mt-2">Step0 自动采集行情/新闻/恐贪指数 → Step1 Searcher 联网搜索实时情报(可选) → Step2 Analyzer 分析300信号矩阵(必需)</p>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-4">
          {/* 角色选择 */}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">角色</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`p-3 rounded-lg border text-sm text-left transition-colors ${role === 'searcher' ? 'border-blue-500 bg-blue-600/10' : 'border-slate-700 hover:border-slate-600'}`}
                onClick={() => handleRoleChange('searcher')}
              >
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-blue-400" />
                  <span className={role === 'searcher' ? 'text-blue-400 font-medium' : ''}>🔍 搜索 Searcher</span>
                </div>
                <p className="text-sm text-slate-500 mt-1">联网搜索实时市场情报（推荐 Perplexity / Gemini）</p>
              </button>
              <button
                className={`p-3 rounded-lg border text-sm text-left transition-colors ${role === 'analyzer' ? 'border-purple-500 bg-purple-600/10' : 'border-slate-700 hover:border-slate-600'}`}
                onClick={() => handleRoleChange('analyzer')}
              >
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-purple-400" />
                  <span className={role === 'analyzer' ? 'text-purple-400 font-medium' : ''}>🧠 分析 Analyzer</span>
                </div>
                <p className="text-sm text-slate-500 mt-1">深度分析300信号矩阵（推荐 DeepSeek / Gemini / GPT）</p>
              </button>
            </div>
          </div>
          {/* 模型提供商 */}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">模型提供商</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {(Object.entries(LLM_PROVIDERS) as [LLMProvider, typeof LLM_PROVIDERS[LLMProvider]][]).map(([key, cfg]) => {
                const supported = cfg.supportedRoles.includes(role);
                return (
                  <button
                    key={key}
                    className={`p-3 rounded-lg border text-sm transition-colors ${
                      !supported ? 'border-slate-800 bg-slate-900/50 opacity-40 cursor-not-allowed' :
                      provider === key ? 'border-purple-500 bg-purple-600/10 text-purple-400' : 'border-slate-700 hover:border-slate-600'
                    }`}
                    onClick={() => supported && handleProviderChange(key)}
                    disabled={!supported}
                  >
                    <p className="font-medium">{cfg.name}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{cfg.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 block mb-1">API Key</label>
              <div className="relative">
                <input className="input-field pr-10" type={showKey ? 'text' : 'password'} placeholder="输入 API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300" onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm text-slate-400 block mb-1">API 地址</label>
              <input className="input-field" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder={LLM_PROVIDERS[provider].defaultUrl} />
            </div>
            <div>
              <label className="text-sm text-slate-400 block mb-1">模型名称</label>
              <input className="input-field" value={model} onChange={(e) => setModel(e.target.value)} placeholder={LLM_PROVIDERS[provider].defaultModel} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-400 block mb-1">最大 Token</label>
                <input className="input-field" type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">温度</label>
                <input className="input-field" type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={handleSave} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存配置'}
            </button>
            <button className="btn-secondary text-sm" onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 已配置列表 - 按角色分组 */}
      {searchers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500 font-medium flex items-center gap-1"><Search className="w-3 h-3" /> 搜索 Searcher</p>
          {searchers.map((c) => (
            <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.enabled ? 'border-blue-500/30 bg-blue-600/5' : 'border-slate-800 bg-slate-800/30'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${c.enabled ? 'bg-blue-400' : 'bg-slate-600'}`} />
                <div>
                  <span className="font-medium text-sm">{LLM_PROVIDERS[c.provider]?.name || c.provider}</span>
                  <span className="text-sm text-slate-500 ml-2">{c.model}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className={`text-sm px-2 py-1 rounded ${c.enabled ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-700 text-slate-400 hover:text-white'}`} onClick={() => handleToggle(c.id!, c.role, !c.enabled)}>
                  {c.enabled ? '已启用' : '启用'}
                </button>
                <button className="p-1 text-slate-500 hover:text-red-400" onClick={() => handleDelete(c.id!)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {analyzers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500 font-medium flex items-center gap-1"><Brain className="w-3 h-3" /> 分析 Analyzer</p>
          {analyzers.map((c) => (
            <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.enabled ? 'border-purple-500/30 bg-purple-600/5' : 'border-slate-800 bg-slate-800/30'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${c.enabled ? 'bg-purple-400' : 'bg-slate-600'}`} />
                <div>
                  <span className="font-medium text-sm">{LLM_PROVIDERS[c.provider]?.name || c.provider}</span>
                  <span className="text-sm text-slate-500 ml-2">{c.model}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className={`text-sm px-2 py-1 rounded ${c.enabled ? 'bg-purple-600/20 text-purple-400' : 'bg-slate-700 text-slate-400 hover:text-white'}`} onClick={() => handleToggle(c.id!, c.role, !c.enabled)}>
                  {c.enabled ? '已启用' : '启用'}
                </button>
                <button className="p-1 text-slate-500 hover:text-red-400" onClick={() => handleDelete(c.id!)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== 子组件: 公共服务配置面板 ====================
const DEFAULT_SERVER_URL = 'http://43.156.216.141:3005';

const REPORT_MODE_OPTIONS: { value: ReportMode; label: string; desc: string; icon: typeof Radio }[] = [
  { value: 'realtime', label: '实时推送', desc: 'SSE 实时接收，有新简报立即通知', icon: Radio },
  { value: 'scheduled', label: '定时汇报', desc: '按设定时间自动扫描并推送简报', icon: CalendarClock },
  { value: 'manual', label: '手动触发', desc: '仅在你点击「扫描」时才执行', icon: Hand },
];

const ALERT_LEVEL_OPTIONS: { value: 'critical' | 'warning' | 'info'; label: string; emoji: string; desc: string }[] = [
  { value: 'critical', label: '紧急预警', emoji: '🔴', desc: '立即推送' },
  { value: 'warning', label: '一般预警', emoji: '🟡', desc: '随简报推送' },
  { value: 'info', label: '信息通知', emoji: '🔵', desc: '低优先级' },
];

// ==================== 全局汇报模式 (localStorage) ====================
const REPORT_MODE_KEY = 'aags-report-mode';
interface ReportModeSettings {
  reportMode: ReportMode;
  scheduledTimes: string[];
  autoScanInterval: number; // 分钟
}
const DEFAULT_REPORT_SETTINGS: ReportModeSettings = { reportMode: 'manual', scheduledTimes: ['08:00', '20:00'], autoScanInterval: 30 };

function getReportModeSettings(): ReportModeSettings {
  try {
    const raw = localStorage.getItem(REPORT_MODE_KEY);
    if (raw) return { ...DEFAULT_REPORT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_REPORT_SETTINGS };
}
function saveReportModeSettings(s: ReportModeSettings) {
  localStorage.setItem(REPORT_MODE_KEY, JSON.stringify(s));
}

// ==================== 独立扫描函数 (不依赖 React 组件, 可在任何页面后台执行) ====================
let _bgScanning = false;
let _bgAborted = false;
async function backgroundScan() {
  console.log('[AutoScan] backgroundScan() 被调用', new Date().toLocaleTimeString());
  if (_bgScanning) { console.log('[AutoScan] 已有扫描在进行中，跳过'); return; }
  _bgScanning = true;
  _bgAborted = false;
  try {
    // 优先公共服务模式
    const config = (await db.publicServiceConfigs.filter(c => c.enabled).toArray())[0];
    if (config) {
      console.log('[AutoScan] 公共服务模式:', config.serverUrl);
      const { briefingId, estimatedSeconds } = await requestScan(config);
      console.log('[AutoScan] 请求已发送, briefingId:', briefingId, '预计:', estimatedSeconds, 's');
      const maxWait = Math.max(60, (estimatedSeconds || 30) * 2) * 1000;
      const start = Date.now();
      let briefing: ScanBriefing | null = null;
      while (Date.now() - start < maxWait) {
        if (_bgAborted) { console.log('[AutoScan] 扫描被用户中止'); _bgScanning = false; return; }
        await new Promise(r => setTimeout(r, 3000));
        if (_bgAborted) { console.log('[AutoScan] 扫描被用户中止'); _bgScanning = false; return; }
        const briefings = await fetchLatestBriefings(config, 1);
        if (briefings.length > 0 && briefings[0].briefingId === briefingId) {
          briefing = briefings[0];
          break;
        }
      }
      if (!briefing) { console.warn('[AutoScan] 扫描超时'); return; }
      const scanTimestamp = briefing.completedAt ? new Date(briefing.completedAt).getTime() : briefing.timestamp;
      await saveBriefing(briefing, scanTimestamp);
      if (config.notifyEnabled && briefing.alerts.length > 0) {
        await notifyBriefing(briefing);
      }
      const allEvents = await db.signalEvents.toArray();
      const result = SentinelScoringEngine.calculateScores(allEvents);
      result.timestamp = scanTimestamp;
      result.scanMode = 'public-service';
      if (briefing.serverTokenUsage) result.serverTokenUsage = briefing.serverTokenUsage;
      if (briefing.startedAt) result.serverStartedAt = briefing.startedAt;
      if (briefing.completedAt) result.serverCompletedAt = briefing.completedAt;
      await db.scoringResults.add(result);
      notifyScanResult(briefing, result).catch((err: any) => console.warn('[AutoScan] 推送失败:', err));
      console.log(`[AutoScan] 公共服务扫描完成 briefingId=${briefingId}`);
      return;
    }

    // Fallback: 自建模式 (本地 LLM)
    let analyzer = (await db.llmConfigs.filter(c => c.enabled && c.role === 'analyzer').toArray())[0];
    if (!analyzer) {
      const anyConfig = (await db.llmConfigs.filter(c => c.enabled).toArray())[0];
      if (!anyConfig) { console.warn('[AutoScan] 无可用 LLM 配置或公共服务配置'); return; }
      if (anyConfig.id && !anyConfig.role) {
        await db.llmConfigs.update(anyConfig.id, { role: 'analyzer' });
        anyConfig.role = 'analyzer';
      }
      analyzer = anyConfig;
    }
    const signalDefs = await db.signalDefinitions.filter(s => s.enabled).toArray();
    if (signalDefs.length === 0) { console.warn('[AutoScan] 无启用的信号定义'); return; }

    console.log('[AutoScan] 自建模式, analyzer:', analyzer.provider, analyzer.model);
    const { events, alerts, marketSummary: summary, pipelineInfo, tokenUsage } = await analyzeSignals(
      analyzer, signalDefs, () => {},
    );
    await saveSignalEvents(events, alerts);

    const allEvents = await db.signalEvents.toArray();
    const result = SentinelScoringEngine.calculateScores(allEvents);
    result.tokenUsage = tokenUsage;
    result.scanMode = 'self-hosted';
    await db.scoringResults.add(result);

    // 保存 ScanBriefing
    const briefing: ScanBriefing = {
      briefingId: `auto-self-${Date.now()}`,
      mode: 'self-hosted',
      timestamp: result.timestamp,
      receivedAt: Date.now(),
      marketSummary: summary,
      triggeredSignals: events.map(e => ({
        signalId: e.signalId, impact: e.impact, confidence: e.confidence,
        title: e.title, summary: e.summary || '', source: e.source,
      })),
      alerts: alerts.map(a => ({
        title: a.title, description: a.description, level: a.level,
        group: a.group, relatedCoins: a.relatedCoins, source: a.source,
      })),
      pipelineInfo,
      notified: false,
    };
    await db.scanBriefings.add(briefing);

    notifyScanResult(briefing, result).catch((err: any) => console.warn('[AutoScan] 推送失败:', err));
    for (const a of alerts) {
      notifyAlert(a).catch((err: any) => console.warn('[AutoScan] 预警推送失败:', err));
    }
    console.log(`[AutoScan] 自建模式扫描完成, 信号:${events.length}, 预警:${alerts.length}`);
  } catch (err: any) {
    console.error('[AutoScan] 扫描失败:', err.message);
    const errMsg = err.message || '';
    const mode = (await db.publicServiceConfigs.filter(c => c.enabled).count()) > 0 ? 'public-service' : 'self-hosted';
    // 精确分类错误类型
    const isTokenInsufficient = errMsg.includes('402') || errMsg.includes('余额不足') || errMsg.includes('insufficient');
    const isRateLimit = errMsg.includes('429') || errMsg.includes('最多请求');
    const reason = isTokenInsufficient ? 'Token 余额不足' : isRateLimit ? '请求频率超限' : '扫描异常';
    const detail = isTokenInsufficient
      ? 'Token 不足，调用公共服务扫描失败，请前往 Sentinel-X 主页充值 Token'
      : isRateLimit
      ? '公共服务请求频率受限，已触发后台每小时扫描次数上限，请联系管理员调高限制或降低自动扫描频率'
      : errMsg;
    // 保存失败记录到 DB
    await db.scanFailures.add({ timestamp: Date.now(), reason, errorDetail: detail, mode });
    // 发送社交通知
    notifyScanFailure(reason, detail)
      .catch(e => console.warn('[AutoScan] 失败通知推送失败:', e));
  } finally {
    _bgScanning = false;
  }
}

// ==================== 全局自动扫描单例 (sessionStorage 持久化, 跨页面/刷新恢复) ====================
const AAGS_AUTO_SCAN_KEY = 'aags-auto-scan-state';

function _loadAagsScanState(): { running: boolean; intervalMins: number; startedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(AAGS_AUTO_SCAN_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function _saveAagsScanState(state: { running: boolean; intervalMins: number; startedAt: number } | null) {
  try {
    if (state) sessionStorage.setItem(AAGS_AUTO_SCAN_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(AAGS_AUTO_SCAN_KEY);
  } catch {}
}

const _globalAutoScan = {
  running: false,
  intervalId: null as ReturnType<typeof setInterval> | null,
  countdownId: null as ReturnType<typeof setInterval> | null,
  countdown: 0,
  totalSec: 0,
  intervalMins: 0,
  startedAt: 0,
  lastScanTime: null as number | null,
  listeners: new Set<() => void>(),
  notify() { this.listeners.forEach(fn => fn()); },
  stop() {
    _bgAborted = true;
    _bgScanning = false;
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    if (this.countdownId) { clearInterval(this.countdownId); this.countdownId = null; }
    this.running = false;
    this.countdown = 0;
    _saveAagsScanState(null);
    this.notify();
    console.log('[AutoScan] 自动扫描已停止');
  },
  _startTimers(mins: number, triggerNow: boolean) {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.countdownId) clearInterval(this.countdownId);
    this.running = true;
    this.intervalMins = mins;
    this.totalSec = mins * 60;
    if (this.startedAt > 0) {
      const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      const cycleElapsed = elapsed % this.totalSec;
      this.countdown = this.totalSec - cycleElapsed;
    } else {
      this.countdown = this.totalSec;
    }
    if (triggerNow) {
      this.lastScanTime = Date.now();
      backgroundScan();
    }
    this.countdownId = setInterval(() => {
      this.countdown = this.countdown <= 1 ? this.totalSec : this.countdown - 1;
      this.notify();
    }, 1000);
    this.intervalId = setInterval(() => {
      console.log('[AutoScan] 定时器触发! 调用 backgroundScan()', new Date().toLocaleTimeString());
      this.lastScanTime = Date.now();
      _saveAagsScanState({ running: true, intervalMins: mins, startedAt: this.startedAt });
      backgroundScan();
      this.notify();
    }, mins * 60 * 1000);
    this.notify();
  },
  start(mins: number) {
    this.stop();
    this.startedAt = Date.now();
    this.lastScanTime = Date.now();
    _saveAagsScanState({ running: true, intervalMins: mins, startedAt: this.startedAt });
    this._startTimers(mins, true);
  },
};

// 模块加载时自动从 sessionStorage 恢复定时器 (SPA 内刷新页面时)
(function _autoRestore() {
  const saved = _loadAagsScanState();
  if (saved?.running && saved.intervalMins > 0) {
    _globalAutoScan.startedAt = saved.startedAt;
    _globalAutoScan.lastScanTime = saved.startedAt;
    _globalAutoScan._startTimers(saved.intervalMins, false);
  }
})();

// ==================== 子组件: 自动扫描面板 (全局, 始终可见) ====================
function AutoScanPanel({ analyzing }: { analyzing: boolean }) {
  const [settings, setSettings] = useState<ReportModeSettings>(getReportModeSettings);
  const [autoRunning, setAutoRunning] = useState(_globalAutoScan.running);
  const [countdown, setCountdown] = useState(_globalAutoScan.countdown);
  const [lastScanTime, setLastScanTime] = useState<number | null>(_globalAutoScan.lastScanTime);

  const update = (patch: Partial<ReportModeSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveReportModeSettings(next);
  };

  // 同步全局状态到组件
  useEffect(() => {
    const sync = () => {
      setAutoRunning(_globalAutoScan.running);
      setCountdown(_globalAutoScan.countdown);
      setLastScanTime(_globalAutoScan.lastScanTime);
    };
    _globalAutoScan.listeners.add(sync);
    sync();
    return () => { _globalAutoScan.listeners.delete(sync); };
  }, []);

  const stopAutoScan = useCallback(() => { _globalAutoScan.stop(); }, []);
  const startAutoScan = useCallback(() => {
    const mins = settings.autoScanInterval;
    if (mins < 1) return;
    _globalAutoScan.start(mins);
  }, [settings.autoScanInterval]);

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="card">
      <details open>
        <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h3 className="text-lg font-semibold flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%)' }}>
              <Timer className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            自动扫描
            {autoRunning && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-600/15 text-emerald-400 border border-emerald-500/20 animate-pulse">
                ● 运行中
              </span>
            )}
          </h3>
          <ChevronDown className="w-5 h-5 text-slate-500 transition-transform duration-200 details-open:rotate-180" />
        </summary>
        <div className="space-y-4 mt-4">
          {/* 扫描间隔 + 启停按钮 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400 shrink-0">扫描间隔</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={settings.autoScanInterval}
                onChange={(e) => update({ autoScanInterval: Math.max(1, parseInt(e.target.value) || 1) })}
                disabled={autoRunning}
                className="input-field w-20 text-sm text-center"
              />
              <span className="text-sm text-slate-500">分钟</span>
            </div>
            <button
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                autoRunning
                  ? 'bg-red-600/15 text-red-400 border border-red-500/30 hover:bg-red-600/25'
                  : 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25'
              }`}
              onClick={autoRunning ? stopAutoScan : startAutoScan}
              disabled={analyzing && !autoRunning}
            >
              {autoRunning ? (
                <><Pause className="w-4 h-4" /> 停止自动扫描</>
              ) : (
                <><Play className="w-4 h-4" /> 启动自动扫描</>
              )}
            </button>
          </div>

          {/* 运行状态 */}
          {autoRunning && (
            <div className="p-3 rounded-lg bg-emerald-600/5 border border-emerald-500/15 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm text-emerald-400">自动扫描运行中</span>
                  <span className="text-sm text-slate-500">每 {settings.autoScanInterval} 分钟扫描一次</span>
                </div>
                <span className="text-sm font-mono text-cyan-400 tabular-nums">
                  {analyzing ? '扫描中...' : `下次: ${formatCountdown(countdown)}`}
                </span>
              </div>
              {/* 进度条 */}
              <div className="h-1 rounded-full bg-slate-700/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-1000"
                  style={{ width: `${Math.max(1, ((settings.autoScanInterval * 60 - countdown) / (settings.autoScanInterval * 60)) * 100)}%` }}
                />
              </div>
              {lastScanTime && (
                <p className="text-xs text-slate-600">
                  上次扫描: {new Date(lastScanTime).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              )}
            </div>
          )}

          {/* 提示文字 */}
          {!autoRunning && (
            <p className="text-xs text-slate-600">
              设置扫描间隔后点击「启动自动扫描」，系统将按设定间隔自动执行信号扫描并推送结果。适用于公共服务和自建模式。
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function PublicServiceConfigPanel() {
  const configs = useLiveQuery(() => db.publicServiceConfigs.toArray(), []);
  const briefings = useLiveQuery(() => db.scanBriefings.orderBy('receivedAt').reverse().limit(10).toArray(), []);

  // ── 连接表单 ──
  const [showForm, setShowForm] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [authToken, setAuthToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── 编辑配置 ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editToken, setEditToken] = useState('');
  const [showEditToken, setShowEditToken] = useState(false);

  // ── 偏好设置 ──
  const [showPrefs, setShowPrefs] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyLevels, setNotifyLevels] = useState<('critical' | 'warning' | 'info')[]>(['critical', 'warning']);
  const [quietStart, setQuietStart] = useState('23:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [briefingFormat, setBriefingFormat] = useState<BriefingFormat>('compact');
  const [enableSearch, setEnableSearch] = useState(true);

  // ── 连接状态 ──
  const [checking, setChecking] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [sseConnected, setSseConnected] = useState(false);
  const disconnectRef = useRef<(() => void) | null>(null);

  const activeConfig = configs?.find(c => c.enabled) || null;

  // 加载已有配置的偏好到 state
  useEffect(() => {
    if (activeConfig) {
      setNotifyEnabled(activeConfig.notifyEnabled ?? true);
      setNotifyLevels((activeConfig.notifyLevels as any[]) ?? ['critical', 'warning']);
      setQuietStart(activeConfig.quietHoursStart || '23:00');
      setQuietEnd(activeConfig.quietHoursEnd || '07:00');
      setBriefingFormat(activeConfig.briefingFormat || 'compact');
      setEnableSearch(activeConfig.enableSearch ?? true);
    }
  }, [activeConfig?.id]);

  // SSE 自动连接 (仅 realtime 模式 — 读全局设置)
  const globalReportMode = getReportModeSettings().reportMode;
  useEffect(() => {
    if (!activeConfig || globalReportMode !== 'realtime') {
      disconnectRef.current?.();
      disconnectRef.current = null;
      setSseConnected(false);
      return;
    }
    const disconnect = connectSSE(
      activeConfig,
      async (briefing) => {
        await saveBriefing(briefing);
        if (activeConfig.notifyEnabled && briefing.alerts.length > 0) {
          await notifyBriefing(briefing);
        }
      },
      (status) => {
        setSseConnected(status.connected);
        if (status.message) setStatusMsg(status.message);
      },
    );
    disconnectRef.current = disconnect;
    return () => { disconnect(); };
  }, [activeConfig?.id, activeConfig?.enabled, globalReportMode]);

  const handleSave = async () => {
    if (!serverUrl.trim() || !authToken.trim()) return;
    setSaving(true);
    try {
      const existing = await db.publicServiceConfigs.toArray();
      for (const c of existing) {
        if (c.id) await db.publicServiceConfigs.update(c.id, { enabled: false });
      }
      const rms = getReportModeSettings();
      await db.publicServiceConfigs.add({
        serverUrl: serverUrl.replace(/\/+$/, ''),
        authToken: encrypt(authToken),
        enabled: true,
        createdAt: Date.now(),
        reportMode: rms.reportMode,
        scheduledTimes: rms.reportMode === 'scheduled' ? rms.scheduledTimes : [],
        notifyEnabled,
        notifyLevels,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        briefingFormat,
        enableSearch,
      });
      setAuthToken('');
      setShowForm(false);
    } catch (err: any) {
      console.error('保存公共服务配置失败:', err);
    }
    setSaving(false);
  };

  const handleSavePrefs = async () => {
    if (!activeConfig?.id) return;
    setSaving(true);
    const rms = getReportModeSettings();
    await db.publicServiceConfigs.update(activeConfig.id, {
      reportMode: rms.reportMode,
      scheduledTimes: rms.reportMode === 'scheduled' ? rms.scheduledTimes : [],
      notifyEnabled,
      notifyLevels,
      quietHoursStart: quietStart,
      quietHoursEnd: quietEnd,
      briefingFormat,
      enableSearch,
    });
    setSaving(false);
    setShowPrefs(false);
  };

  const handleCheck = async () => {
    if (!activeConfig) return;
    setChecking(true);
    setStatusMsg('检测中...');
    const result = await checkServiceStatus(activeConfig);
    setStatusMsg(result.ok
      ? `✅ 连接正常${result.version ? ` (v${result.version})` : ''}`
      : `❌ ${result.message || '连接失败'}`
    );
    setChecking(false);
  };

  const handleDelete = async (id: number) => {
    disconnectRef.current?.();
    disconnectRef.current = null;
    setSseConnected(false);
    await db.publicServiceConfigs.delete(id);
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    if (enabled) {
      const all = await db.publicServiceConfigs.toArray();
      for (const c of all) { if (c.id && c.id !== id) await db.publicServiceConfigs.update(c.id, { enabled: false }); }
    }
    await db.publicServiceConfigs.update(id, { enabled });
  };

  const toggleNotifyLevel = (level: 'critical' | 'warning' | 'info') => {
    setNotifyLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const reportModeLabel = (m: ReportMode) => REPORT_MODE_OPTIONS.find(o => o.value === m)?.label || m;

  const handleStartEdit = (c: any) => {
    setEditingId(c.id);
    setEditUrl(c.serverUrl);
    setEditToken(decrypt(c.authToken));
    setShowEditToken(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editUrl.trim() || !editToken.trim()) return;
    setSaving(true);
    await db.publicServiceConfigs.update(editingId, {
      serverUrl: editUrl.replace(/\/+$/, ''),
      authToken: encrypt(editToken),
    });
    setEditingId(null);
    setEditUrl('');
    setEditToken('');
    setSaving(false);
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a
            href={activeConfig?.serverUrl || DEFAULT_SERVER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" /> 进入主页
          </a>
        </div>
        <button className="btn-primary text-sm flex items-center gap-1" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4" /> 配置服务
        </button>
      </div>

      {/* 说明 */}
      <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/30 space-y-2">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Server className="w-4 h-4 text-cyan-400" />
            <span className="text-slate-400">服务端完成全部扫描</span>
          </div>
          <span className="text-slate-600">→</span>
          <div className="flex items-center gap-1.5">
            <Send className="w-4 h-4 text-blue-400" />
            <span className="text-slate-400">推送简报到客户端</span>
          </div>
          <span className="text-slate-600">→</span>
          <div className="flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">同步社交工具</span>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          无需配置 API Key。在公共服务主页注册账号并获取认证令牌，即可使用完整的 Perplexity + DeepSeek/Gemini 分析管线。每次扫描消耗 Token 余额。
        </p>
      </div>

      {/* ── 新建配置表单 ── */}
      {showForm && (
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-4">
          <div>
            <label className="text-sm text-slate-400 block mb-1">服务器地址</label>
            <input className="input-field" placeholder={DEFAULT_SERVER_URL} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">认证令牌</label>
            <p className="text-sm text-slate-600 mb-1">在公共服务主页 → API 令牌页面生成</p>
            <div className="relative">
              <input className="input-field pr-10" type={showToken ? 'text' : 'password'} placeholder="stx_xxxxxxxx" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300" onClick={() => setShowToken(!showToken)}>
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={handleSave} disabled={saving || !serverUrl.trim() || !authToken.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存配置'}
            </button>
            <button className="btn-secondary text-sm" onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}

      {/* ── 已配置列表 ── */}
      {configs && configs.length > 0 && (
        <div className="space-y-2">
          {configs.map((c) => (
            <div key={c.id} className={`rounded-xl border overflow-hidden ${c.enabled ? 'border-cyan-500/30 bg-cyan-600/5' : 'border-slate-800 bg-slate-800/30'}`}>
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${c.enabled && sseConnected ? 'bg-emerald-400 animate-pulse' : c.enabled ? 'bg-yellow-400' : 'bg-slate-600'}`} />
                  <div>
                    <span className="font-medium text-sm">{c.serverUrl}</span>
                    {c.enabled && (
                      <span className={`text-sm ml-2 ${sseConnected ? 'text-emerald-400' : 'text-yellow-400'}`}>
                        {globalReportMode === 'realtime' ? (sseConnected ? '● 实时连接中' : '○ 未连接') : `📋 ${reportModeLabel(globalReportMode)}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.enabled && (
                    <>
                      <button className="text-sm px-2 py-1 rounded bg-slate-700 text-slate-400 hover:text-white" onClick={handleCheck} disabled={checking}>
                        {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : '检测'}
                      </button>
                      <button className="text-sm px-2 py-1 rounded bg-slate-700 text-slate-400 hover:text-white" onClick={() => editingId === c.id ? setEditingId(null) : handleStartEdit(c)}>
                        编辑
                      </button>
                      <button className="text-sm px-2 py-1 rounded bg-slate-700 text-slate-400 hover:text-white" onClick={() => setShowPrefs(!showPrefs)}>
                        偏好
                      </button>
                    </>
                  )}
                  <button className={`text-sm px-2 py-1 rounded ${c.enabled ? 'bg-cyan-600/20 text-cyan-400' : 'bg-slate-700 text-slate-400 hover:text-white'}`} onClick={() => handleToggle(c.id!, !c.enabled)}>
                    {c.enabled ? '已启用' : '启用'}
                  </button>
                  <button className="p-1 text-slate-500 hover:text-red-400" onClick={() => handleDelete(c.id!)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {statusMsg && c.enabled && (
                <p className="text-sm text-slate-500 px-3 pb-1">{statusMsg}</p>
              )}
              {c.enabled && (
                <div className="flex items-center gap-3 px-3 pb-2 text-sm text-slate-600">
                  <span>模式: {reportModeLabel(globalReportMode)}</span>
                  <span>通知: {c.notifyEnabled ? `${c.notifyLevels.length}级` : '关闭'}</span>
                  <span>搜索增强: {c.enableSearch ? '开' : '关'}</span>
                  {c.lastConnectedAt && <span>上次: {new Date(c.lastConnectedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
              )}

              {/* ── 编辑面板 ── */}
              {editingId === c.id && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-3">
                    <div>
                      <label className="text-sm text-slate-400 block mb-1">服务器地址</label>
                      <input className="input-field" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-sm text-slate-400 block mb-1">API 认证令牌</label>
                      <div className="relative">
                        <input className="input-field pr-10" type={showEditToken ? 'text' : 'password'} value={editToken} onChange={(e) => setEditToken(e.target.value)} />
                        <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300" onClick={() => setShowEditToken(!showEditToken)}>
                          {showEditToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary text-sm" onClick={handleSaveEdit} disabled={saving || !editUrl.trim() || !editToken.trim()}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存'}
                      </button>
                      <button className="btn-secondary text-sm" onClick={() => setEditingId(null)}>取消</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 偏好设置面板 ── */}
      {showPrefs && activeConfig && (
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-5">
          <h4 className="text-sm font-semibold text-slate-300">⚙️ 偏好设置</h4>

          {/* 通知同步 */}
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-500 mb-2 cursor-pointer">
              <input type="checkbox" checked={notifyEnabled} onChange={(e) => setNotifyEnabled(e.target.checked)} className="rounded" />
              📱 简报同步到社交工具 (Telegram / WhatsApp)
            </label>
            {notifyEnabled && (
              <div className="pl-5 space-y-3">
                <div className="space-y-1.5">
                  <p className="text-sm text-slate-600">推送级别:</p>
                  {ALERT_LEVEL_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={notifyLevels.includes(opt.value)} onChange={() => toggleNotifyLevel(opt.value)} className="rounded" />
                      <span>{opt.emoji} {opt.label}</span>
                      <span className="text-sm text-slate-600">— {opt.desc}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">静默时段:</span>
                  <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="input-field w-24 text-sm" />
                  <span className="text-slate-600">~</span>
                  <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="input-field w-24 text-sm" />
                  <span className="text-sm text-slate-600">此时段不推送</span>
                </div>
                <div>
                  <span className="text-sm text-slate-600 mr-2">简报格式:</span>
                  <select value={briefingFormat} onChange={(e) => setBriefingFormat(e.target.value as BriefingFormat)} className="input-field w-32 text-sm">
                    <option value="compact">精简版 — 关键指标</option>
                    <option value="full">完整版 — 全部详情</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 扫描偏好 */}
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer">
              <input type="checkbox" checked={enableSearch} onChange={(e) => setEnableSearch(e.target.checked)} className="rounded" />
              ⚡ 搜索增强 <span className="text-sm text-slate-600">(Perplexity 联网搜索，额外消耗 1 Token/次)</span>
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <button className="btn-primary text-sm" onClick={handleSavePrefs} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存偏好'}
            </button>
            <button className="btn-secondary text-sm" onClick={() => setShowPrefs(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 简报历史 */}
      {briefings && briefings.length > 0 && (
        <BriefingList briefings={briefings} />
      )}
    </div>
  );
}

// ==================== 子组件: 简报列表 ====================
function BriefingList({ briefings }: { briefings: ScanBriefing[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500 font-medium flex items-center gap-1">
        <Clock className="w-3 h-3" /> 最近简报 ({briefings.length})
      </p>
      {briefings.map((b) => {
        const isExpanded = expandedId === b.briefingId;
        const time = new Date(b.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const hasCritical = b.alerts.some(a => a.level === 'critical');
        return (
          <div key={b.briefingId} className={`rounded-xl border overflow-hidden ${hasCritical ? 'border-red-500/30' : 'border-slate-800'}`}>
            <button
              className="w-full flex items-center justify-between p-3 hover:bg-slate-800/30 transition-colors text-left"
              onClick={() => setExpandedId(isExpanded ? null : b.briefingId)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-sm text-slate-600">{time}</span>
                <span className="text-sm px-1.5 py-0.5 rounded bg-cyan-600/10 text-cyan-400">{b.mode === 'public-service' ? '公共' : '自建'}</span>
                <span className="text-sm truncate">{b.marketSummary ? b.marketSummary.slice(0, 60) + '...' : '无摘要'}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-sm text-slate-500">{b.triggeredSignals.length} 信号</span>
                {b.alerts.length > 0 && <span className="text-sm text-amber-400">{b.alerts.length} 预警</span>}
                {b.notified && <span className="text-sm text-emerald-500">✓ 已推送</span>}
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
              </div>
            </button>
            {isExpanded && (
              <div className="px-4 pb-3 space-y-3 border-t border-slate-800/50">
                {b.marketSummary && (
                  <p className="text-sm text-slate-300 leading-relaxed mt-2">{b.marketSummary}</p>
                )}
                {b.triggeredSignals.length > 0 && (
                  <div>
                    <p className="text-sm text-slate-500 mb-1">触发信号:</p>
                    <div className="space-y-1">
                      {b.triggeredSignals.slice(0, 8).map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className={s.impact > 0 ? 'text-emerald-400' : 'text-red-400'}>{s.impact > 0 ? '📈' : '📉'}</span>
                          <span className="text-slate-600">#{s.signalId}</span>
                          <span className="text-slate-300">{s.title}</span>
                          <span className={`tabular-nums ${s.impact > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.impact > 0 ? '+' : ''}{s.impact}</span>
                        </div>
                      ))}
                      {b.triggeredSignals.length > 8 && <p className="text-sm text-slate-600">...还有 {b.triggeredSignals.length - 8} 条</p>}
                    </div>
                  </div>
                )}
                {b.alerts.length > 0 && (
                  <div>
                    <p className="text-sm text-slate-500 mb-1">预警:</p>
                    {b.alerts.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span>{a.level === 'critical' ? '🔴' : a.level === 'warning' ? '🟡' : '🔵'}</span>
                        <span className="text-slate-300">{a.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <span>管线: {b.pipelineInfo.hasSearcher ? '搜索+分析' : '仅分析'}</span>
                  <span>分析: {b.pipelineInfo.analyzerProvider}</span>
                  <span>接收: {new Date(b.receivedAt).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== 子组件: 管线配置面板 (双模式切换) ====================
function PipelineConfigPanel({ scanMode, onModeChange }: { scanMode: ScanMode; onModeChange: (m: ScanMode) => void }) {
  return (
    <div className="space-y-4">
      {/* 模式切换 */}
      <div className="grid grid-cols-2 gap-3">
        <button
          className="flex flex-col items-center justify-center gap-1.5 py-5 px-4 rounded-xl transition-all duration-200"
          style={scanMode === 'public-service'
            ? { background: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(6,182,212,0.05) 100%)', border: '1px solid rgba(6,182,212,0.3)', boxShadow: '0 0 20px -4px rgba(6,182,212,0.15)' }
            : { background: 'linear-gradient(135deg, rgba(30,41,59,0.6) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(51,65,85,0.3)' }
          }
          onClick={() => onModeChange('public-service')}
        >
          <Globe className={`w-6 h-6 ${scanMode === 'public-service' ? 'text-cyan-400' : 'text-slate-500'}`} />
          <span className={`text-lg font-bold tracking-tight ${scanMode === 'public-service' ? 'text-cyan-300' : 'text-slate-400'}`}>公共服务</span>
          <span className={`text-sm ${scanMode === 'public-service' ? 'text-cyan-400/60' : 'text-slate-600'}`}>接收推送简报</span>
        </button>
        <button
          className="flex flex-col items-center justify-center gap-1.5 py-5 px-4 rounded-xl transition-all duration-200"
          style={scanMode === 'self-hosted'
            ? { background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.05) 100%)', border: '1px solid rgba(139,92,246,0.3)', boxShadow: '0 0 20px -4px rgba(139,92,246,0.15)' }
            : { background: 'linear-gradient(135deg, rgba(30,41,59,0.6) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(51,65,85,0.3)' }
          }
          onClick={() => onModeChange('self-hosted')}
        >
          <Settings2 className={`w-6 h-6 ${scanMode === 'self-hosted' ? 'text-purple-400' : 'text-slate-500'}`} />
          <span className={`text-lg font-bold tracking-tight ${scanMode === 'self-hosted' ? 'text-purple-300' : 'text-slate-400'}`}>自建模式</span>
          <span className={`text-sm ${scanMode === 'self-hosted' ? 'text-purple-400/60' : 'text-slate-600'}`}>自己配置 API Key</span>
        </button>
      </div>

      {/* 模式内容 */}
      {scanMode === 'public-service' ? <PublicServiceConfigPanel /> : <LLMConfigPanel />}
    </div>
  );
}

// ==================== 子组件: 评分仪表盘 ====================
function ScoringDashboard({ scores, gridParams, marketSummary }: { scores: ScoringResult | null; gridParams: GridAutoParams | null; marketSummary: string }) {
  const sdColor = (v: number) => v > 20 ? 'text-emerald-400' : v < -20 ? 'text-red-400' : 'text-yellow-400';
  const svColor = (v: number) => v > 70 ? 'text-red-400' : v > 30 ? 'text-yellow-400' : 'text-emerald-400';
  const srColor = (v: number) => v > 85 ? 'text-red-500 animate-pulse' : v > 60 ? 'text-red-400' : v > 30 ? 'text-yellow-400' : 'text-emerald-400';

  const sdLabel = (v: number) => v > 40 ? '强烈看多' : v > 20 ? '偏多' : v < -40 ? '强烈看空' : v < -20 ? '偏空' : '中性';
  const svLabel = (v: number) => v > 70 ? '高波动' : v > 30 ? '中波动' : '低波动';
  const srLabel = (v: number) => v > 85 ? '🚨 熔断' : v > 60 ? '高风险' : v > 30 ? '中风险' : '低风险';

  const barWidth = (v: number, max: number) => `${Math.min(100, Math.max(0, ((v + max) / (max * 2)) * 100))}%`;
  const absBarWidth = (v: number) => `${Math.min(100, Math.max(0, v))}%`;

  return (
    <div className="card space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Gauge className="w-5 h-5 text-cyan-400" />
        Sentinel-X 实时评分
        {scores && <span className="text-sm text-slate-500 font-normal ml-2">活跃信号: {scores.activeSignals}</span>}
      </h3>

      <details className="group">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400 transition-colors flex items-center gap-1 select-none">
          <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
          评分原理说明
        </summary>
        <div className="mt-2 p-3 rounded-lg bg-slate-800/30 border border-slate-700/20 text-xs text-slate-400 space-y-1.5">
          <p><strong className="text-slate-300">数据来源：</strong>评分基于「扫描信号」触发的信号事件，而非 300 个信号定义本身。每次扫描时 LLM 分析当前市场新闻，从 300 个预定义信号中识别出实际触发的事件。</p>
          <p><strong className="text-slate-300">计算方式：</strong>对所有已触发且未过期的信号事件，按 <span className="text-cyan-400">影响力 × 置信度 × 时间衰减因子</span> 加权求和，分别汇入 D(方向)、V(波动)、R(风险) 三个维度，最终压缩为 SD/SV/SR 三个评分。评分计算在本地完成，不消耗 Token。</p>
          <p><strong className="text-slate-300">时间衰减：</strong>每个信号有独立的半衰期（数小时至数天），触发后影响力随时间指数衰减，衰减至 1% 以下自动忽略。因此即使不重新扫描，评分也会随时间自然变化。</p>
          <p className="text-amber-400/80 flex items-center gap-1">💡 <strong>提高扫描频率可以显著提升评分准确性</strong> — 更频繁地扫描 300 信号能捕捉到更多最新市场变化，使评分数据更全面、更及时，减少信息盲区。建议根据市场活跃程度适当增加扫描频率。</p>
        </div>
      </details>

      {!scores ? (
        <div className="p-8 text-center text-slate-500">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无评分数据</p>
          <p className="text-sm mt-1">点击「扫描信号」开始分析</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* SD 方向分 */}
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-500 flex items-center gap-1">
                  {scores.scoreDirection > 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  SD 方向分
                </span>
                <span className={`text-sm font-medium ${sdColor(scores.scoreDirection)}`}>{sdLabel(scores.scoreDirection)}</span>
              </div>
              <p className="text-xs text-slate-600 mb-1">综合所有方向类(D)信号的加权得分，反映市场多空力量对比。正值看多、负值看空，经 tanh 压缩至 [-100, +100]</p>
              <p className={`text-3xl font-bold tabular-nums ${sdColor(scores.scoreDirection)}`}>
                {scores.scoreDirection > 0 ? '+' : ''}{scores.scoreDirection.toFixed(1)}
              </p>
              <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden relative">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                <div className="h-full rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-emerald-500 transition-all" style={{ width: barWidth(scores.scoreDirection, 100) }} />
              </div>
              <div className="flex justify-between text-sm text-slate-600 mt-1">
                <span>-100</span><span>0</span><span>+100</span>
              </div>
            </div>
            {/* SV 波动分 */}
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-500 flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> SV 波动分</span>
                <span className={`text-sm font-medium ${svColor(scores.scoreVolatility)}`}>{svLabel(scores.scoreVolatility)}</span>
              </div>
              <p className="text-xs text-slate-600 mb-1">综合所有波动类(V)信号的绝对值，衡量市场波动预期。&lt;30 低波动适合窄幅网格，&gt;70 高波动需加大间距防御</p>
              <p className={`text-3xl font-bold tabular-nums ${svColor(scores.scoreVolatility)}`}>
                {scores.scoreVolatility.toFixed(1)}
              </p>
              <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${scores.scoreVolatility > 70 ? 'bg-red-500' : scores.scoreVolatility > 30 ? 'bg-yellow-500' : 'bg-emerald-500'}`} style={{ width: absBarWidth(scores.scoreVolatility) }} />
              </div>
              <div className="flex justify-between text-sm text-slate-600 mt-1">
                <span>0</span><span>30</span><span>70</span><span>100</span>
              </div>
            </div>
            {/* SR 风险分 */}
            <div className={`p-4 rounded-xl border ${scores.scoreRisk > 85 ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-800/40 border-slate-700/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-500 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> SR 风险分</span>
                <span className={`text-sm font-medium ${srColor(scores.scoreRisk)}`}>{srLabel(scores.scoreRisk)}</span>
              </div>
              <p className="text-xs text-slate-600 mb-1">综合所有风险类(R)信号的绝对值，衡量黑天鹅/系统性风险。&gt;60 高风险应减仓，&gt;85 触发熔断自动停止交易</p>
              <p className={`text-3xl font-bold tabular-nums ${srColor(scores.scoreRisk)}`}>
                {scores.scoreRisk.toFixed(1)}
              </p>
              <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${scores.scoreRisk > 85 ? 'bg-red-600 animate-pulse' : scores.scoreRisk > 60 ? 'bg-red-500' : scores.scoreRisk > 30 ? 'bg-yellow-500' : 'bg-emerald-500'}`} style={{ width: absBarWidth(scores.scoreRisk) }} />
              </div>
              <div className="flex justify-between text-sm text-slate-600 mt-1">
                <span>0</span><span>30</span><span>60</span><span>85</span><span>100</span>
              </div>
            </div>
          </div>

          {/* 网格自动调参 */}
          {gridParams && (
            <div className="p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-amber-400" />
                网格调参建议
                {gridParams.circuitBreak && <span className="text-sm px-2 py-0.5 rounded-full bg-red-600/20 text-red-400 animate-pulse">🚨 熔断触发 — KILL ALL</span>}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-800/60">
                  <p className="text-sm text-slate-500 mb-1">间距策略</p>
                  <p className="text-lg font-bold text-white">{gridParams.spacing}%</p>
                  <p className="text-sm text-slate-400">{gridParams.spacingMode === 'narrow' ? '窄幅收割' : gridParams.spacingMode === 'standard' ? '标准模式' : '防御宽幅'}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60">
                  <p className="text-sm text-slate-500 mb-1">倾斜策略</p>
                  <p className={`text-lg font-bold ${gridParams.skewMode === 'bullish' ? 'text-emerald-400' : gridParams.skewMode === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>
                    {gridParams.skewMode === 'bullish' ? '看涨网格' : gridParams.skewMode === 'bearish' ? '看跌网格' : '中性网格'}
                  </p>
                  <p className="text-sm text-slate-400">买{Math.round(gridParams.buyRatio * 100)}% / 卖{Math.round(gridParams.sellRatio * 100)}%</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60">
                  <p className="text-sm text-slate-500 mb-1">买单比例</p>
                  <div className="flex items-end gap-1">
                    <p className="text-lg font-bold text-emerald-400">{Math.round(gridParams.buyRatio * 100)}%</p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${gridParams.buyRatio * 100}%` }} />
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60">
                  <p className="text-sm text-slate-500 mb-1">卖单比例</p>
                  <div className="flex items-end gap-1">
                    <p className="text-lg font-bold text-red-400">{Math.round(gridParams.sellRatio * 100)}%</p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${gridParams.sellRatio * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 市场综合分析 */}
          {marketSummary && (
            <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15">
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                <RefreshCw className="w-4 h-4 text-cyan-400" />
                市场综合分析
                <span className="text-xs text-slate-500 font-normal ml-auto">扫描于 {new Date(scores.timestamp).toLocaleString('zh-CN')}</span>
              </h4>
              <p className="text-sm text-slate-300 leading-relaxed">{marketSummary}</p>
            </div>
          )}

          <p className="text-sm text-slate-600 text-right">
            评分时间: {new Date(scores.timestamp).toLocaleString('zh-CN')}
          </p>
        </>
      )}
    </div>
  );
}

// ==================== 子组件: 信号矩阵管理 ====================
function SignalMatrixPanel({ onScan, analyzing, progress }: { onScan: () => void; analyzing: boolean; progress: PipelineProgress | null }) {
  const signalDefs = useLiveQuery(() => db.signalDefinitions.orderBy('signalId').toArray(), []);
  const llmConfigs = useLiveQuery(() => db.llmConfigs.filter(c => c.enabled).toArray(), []);
  const [expandedGroup, setExpandedGroup] = useState<SignalGroup | null>(null);
  const [searchText, setSearchText] = useState('');
  const [panelExpanded, setPanelExpanded] = useState(false);
  const seeded = useRef(false);

  // 首次加载时自动填充300条信号定义
  useEffect(() => {
    if (seeded.current || signalDefs === undefined) return;
    if (signalDefs.length === 0) {
      seeded.current = true;
      const items: Omit<SignalDefinition, 'id'>[] = SIGNAL_MATRIX.map(s => ({ ...s, enabled: true }));
      db.signalDefinitions.bulkAdd(items as SignalDefinition[]).catch(console.error);
    }
  }, [signalDefs]);

  const handleToggle = async (id: number, enabled: boolean) => {
    await db.signalDefinitions.update(id, { enabled });
  };

  const handleToggleGroup = async (group: SignalGroup, enabled: boolean) => {
    const items = signalDefs?.filter(s => s.group === group) || [];
    for (const item of items) {
      if (item.id) await db.signalDefinitions.update(item.id, { enabled });
    }
  };

  const handleResetDefaults = async () => {
    if (!confirm('确定重置为300条默认信号？当前所有自定义修改将被覆盖。')) return;
    await db.signalDefinitions.clear();
    const items: Omit<SignalDefinition, 'id'>[] = SIGNAL_MATRIX.map(s => ({ ...s, enabled: true }));
    await db.signalDefinitions.bulkAdd(items as SignalDefinition[]);
  };

  const hasLLM = llmConfigs && llmConfigs.length > 0;
  const enabledCount = signalDefs?.filter(s => s.enabled).length || 0;
  const totalCount = signalDefs?.length || 0;

  // 搜索过滤
  const filteredDefs = useMemo(() => {
    if (!signalDefs) return [];
    if (!searchText.trim()) return signalDefs;
    const q = searchText.toLowerCase();
    return signalDefs.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.triggerCondition.toLowerCase().includes(q) ||
      String(s.signalId).includes(q)
    );
  }, [signalDefs, searchText]);

  const catBadge = (cat: string) => {
    switch (cat) {
      case 'D': return <span className="text-sm px-1.5 py-0.5 rounded bg-blue-600/15 text-blue-400 border border-blue-500/20">D方向</span>;
      case 'V': return <span className="text-sm px-1.5 py-0.5 rounded bg-amber-600/15 text-amber-400 border border-amber-500/20">V波动</span>;
      case 'R': return <span className="text-sm px-1.5 py-0.5 rounded bg-red-600/15 text-red-400 border border-red-500/20">R风险</span>;
      default: return null;
    }
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button className="flex items-center gap-2 text-left" onClick={() => setPanelExpanded(!panelExpanded)}>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            信号矩阵
            <span className="text-sm text-slate-500 font-normal">({enabledCount}/{totalCount} 启用)</span>
          </h3>
          {panelExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm flex items-center gap-1" onClick={handleResetDefaults} title="重置为默认300条信号">
            <RefreshCw className="w-3.5 h-3.5" /> 重置默认
          </button>
          <button
            className={`btn-primary text-sm flex items-center gap-2 ${analyzing ? 'opacity-80 cursor-not-allowed' : ''}`}
            onClick={onScan}
            disabled={!hasLLM || enabledCount === 0 || analyzing}
            title={analyzing ? '扫描进行中，请等待完成' : !hasLLM ? '请先配置 LLM' : enabledCount === 0 ? '请启用信号' : '扫描信号'}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress ? progress.label : '扫描中...'}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> 扫描信号 ({enabledCount})
              </>
            )}
          </button>
        </div>
      </div>

      {panelExpanded && (<>
      <p className="text-sm text-slate-500">
        300条信号按10个组分类，覆盖宏观流动性、央行政策、监管合规、机构资金流、链上行为、市场结构、情绪指标、叙事赛道、黑天鹅安全、关键人物地缘。每条信号预设权重(Impact)、半衰期(HalfLife)和归类(D方向/V波动/R风险)。
      </p>

      {/* 搜索 */}
      <input
        className="input-field text-sm"
        placeholder="搜索信号名称、条件或编号..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
      />

      {/* 按组展示 */}
      <div className="space-y-2">
        {SIGNAL_GROUPS.map((groupCfg) => {
          const items = filteredDefs.filter(s => s.group === groupCfg.id);
          if (searchText && items.length === 0) return null;
          const allItems = signalDefs?.filter(s => s.group === groupCfg.id) || [];
          const enabledInGroup = allItems.filter(s => s.enabled).length;
          const isExpanded = expandedGroup === groupCfg.id;

          return (
            <div key={groupCfg.id} className="rounded-xl border border-slate-800 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
                onClick={() => setExpandedGroup(isExpanded ? null : groupCfg.id)}
              >
                <div className="flex items-center gap-2">
                  <span>{groupCfg.icon}</span>
                  <span className="font-medium text-sm">[{groupCfg.id}] {groupCfg.label}</span>
                  <span className="text-sm text-slate-500">({enabledInGroup}/{allItems.length})</span>
                  <span className="text-sm text-slate-600">#{groupCfg.range[0]}-{groupCfg.range[1]}</span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {isExpanded && (
                <div className="px-4 py-2 space-y-1 max-h-80 overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/50">
                    <p className="text-sm text-slate-500">{groupCfg.description}</p>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <button className="text-sm px-2 py-0.5 rounded bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25" onClick={() => handleToggleGroup(groupCfg.id, true)}>全启</button>
                      <button className="text-sm px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600" onClick={() => handleToggleGroup(groupCfg.id, false)}>全禁</button>
                    </div>
                  </div>
                  {(searchText ? items : allItems).map((sig) => (
                    <div key={sig.id} className="flex items-center gap-2 py-1 group text-sm">
                      <input type="checkbox" checked={sig.enabled} onChange={(e) => handleToggle(sig.id!, e.target.checked)} className="rounded shrink-0" />
                      <span className="text-sm text-slate-600 w-8 shrink-0 tabular-nums">#{sig.signalId}</span>
                      <span className={`flex-1 text-sm ${sig.enabled ? 'text-slate-200' : 'text-slate-500'}`}>{sig.name}</span>
                      {catBadge(sig.category)}
                      <span className={`text-sm w-10 text-right tabular-nums shrink-0 ${sig.impact > 0 ? 'text-emerald-500' : sig.impact < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                        {sig.impact > 0 ? '+' : ''}{sig.impact}
                      </span>
                      <span className="text-sm text-slate-600 w-14 text-right shrink-0 tabular-nums">{sig.halfLife}m</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}
    </div>
  );
}

// ==================== 子组件: 扫描记录 (按扫描批次分组) ====================
function SignalEventHistory() {
  const events = useLiveQuery(
    () => db.signalEvents.orderBy('triggeredAt').reverse().limit(200).toArray(),
    [],
  );
  const scoringResults = useLiveQuery(
    () => db.scoringResults.orderBy('timestamp').reverse().limit(20).toArray(),
    [],
  );
  const briefings = useLiveQuery(
    () => db.scanBriefings.orderBy('receivedAt').reverse().limit(20).toArray(),
    [],
  );
  const scanFailures = useLiveQuery(
    () => db.scanFailures.orderBy('timestamp').reverse().limit(20).toArray(),
    [],
  );
  const [expandedScan, setExpandedScan] = useState<number | null>(null);

  // 以 scoringResults 为主数据源构建扫描记录（每次扫描必有一条），辅以 signalEvents 展示详情
  const scanRecords = useMemo(() => {
    if (!scoringResults || scoringResults.length === 0) {
      // 兼容旧数据: 如果只有 signalEvents 没有 scoringResults，按 triggeredAt 分组
      if (!events || events.length === 0) return [];
      const groups = new Map<number, typeof events>();
      for (const evt of events) {
        const key = evt.triggeredAt;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(evt);
      }
      return Array.from(groups.entries())
        .sort((a, b) => b[0] - a[0])
        .slice(0, 14)
        .map(([timestamp, evts]) => {
          const netImpact = evts.reduce((sum, e) => sum + e.impact, 0);
          const bullish = evts.filter(e => e.impact > 0).length;
          const bearish = evts.filter(e => e.impact < 0).length;
          const groupCounts = new Map<string, number>();
          for (const e of evts) groupCounts.set(e.group, (groupCounts.get(e.group) || 0) + 1);
          const topGroups = Array.from(groupCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
          const isPublic = evts.some(e => e.source.includes('公共服务'));
          const matchedBriefing = briefings?.find(b => Math.abs(b.timestamp - timestamp) < 5000);
          return { timestamp, events: evts, netImpact, bullish, bearish, topGroups, isPublic, tokenUsage: undefined as any, scanMode: undefined as any, scoreDirection: undefined as number | undefined, scoreVolatility: undefined as number | undefined, scoreRisk: undefined as number | undefined, activeSignals: undefined as number | undefined, marketSummary: matchedBriefing?.marketSummary || '', serverTokenUsage: matchedBriefing?.serverTokenUsage, startedAt: matchedBriefing?.startedAt, completedAt: matchedBriefing?.completedAt };
        });
    }

    // 按 scoringResult.timestamp 为主键，匹配 signalEvents (±5s 容差)
    type SigEvt = NonNullable<typeof events>[number];
    const eventsByTs = new Map<number, SigEvt[]>();
    if (events) {
      for (const evt of events) {
        const key = evt.triggeredAt;
        if (!eventsByTs.has(key)) eventsByTs.set(key, []);
        eventsByTs.get(key)!.push(evt);
      }
    }
    const findEvents = (ts: number): SigEvt[] => {
      if (eventsByTs.has(ts)) return eventsByTs.get(ts)!;
      for (const [evtTs, evts] of eventsByTs) {
        if (Math.abs(evtTs - ts) < 5000) return evts;
      }
      return [];
    };

    return scoringResults
      .slice(0, 14)
      .map((sr) => {
        const evts = findEvents(sr.timestamp);
        const netImpact = evts.reduce((sum, e) => sum + e.impact, 0);
        const bullish = evts.filter(e => e.impact > 0).length;
        const bearish = evts.filter(e => e.impact < 0).length;
        const groupCounts = new Map<string, number>();
        for (const e of evts) groupCounts.set(e.group, (groupCounts.get(e.group) || 0) + 1);
        const topGroups = Array.from(groupCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const isPublic = sr.scanMode === 'public-service';
        const matchedBriefing = briefings?.find(b => Math.abs(b.timestamp - sr.timestamp) < 5000);
        return {
          timestamp: sr.timestamp,
          events: evts,
          netImpact,
          bullish,
          bearish,
          topGroups,
          isPublic,
          tokenUsage: sr.tokenUsage,
          scanMode: sr.scanMode,
          scoreDirection: sr.scoreDirection,
          scoreVolatility: sr.scoreVolatility,
          scoreRisk: sr.scoreRisk,
          activeSignals: sr.activeSignals,
          marketSummary: matchedBriefing?.marketSummary || '',
          serverTokenUsage: sr.serverTokenUsage || matchedBriefing?.serverTokenUsage,
          startedAt: sr.serverStartedAt || matchedBriefing?.startedAt,
          completedAt: sr.serverCompletedAt || matchedBriefing?.completedAt,
        };
      });
  }, [events, scoringResults, briefings]);

  if (scanRecords.length === 0) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-amber-400" />
          扫描记录
        </h3>
        <div className="p-8 text-center text-slate-500">
          <p className="text-sm">暂无扫描记录</p>
          <p className="text-sm mt-1">点击「扫描信号」让 LLM 分析当前市场</p>
        </div>
      </div>
    );
  }

  const groupLabel = (g: string) => SIGNAL_GROUPS.find(gr => gr.id === g);

  const hasFailures = scanFailures && scanFailures.length > 0;

  return (
    <div className="card space-y-4">
      {/* 两列并排布局 */}
      <div className={`grid gap-4 ${hasFailures ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* 左列: 扫描记录 */}
        <div className="space-y-3 min-w-0">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            扫描记录
            <span className="text-sm text-slate-500 font-normal ml-1">(最近 {scanRecords.length} 次)</span>
          </h3>
          <div className="space-y-2">
            {scanRecords.map((scan) => {
              const isExpanded = expandedScan === scan.timestamp;
              const time = new Date(scan.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              return (
                <div key={scan.timestamp} className={`rounded-xl border overflow-hidden ${
                  Math.abs(scan.netImpact) > 50 ? 'border-amber-500/20' : 'border-slate-800'
                }`}>
                  {/* 扫描摘要行 */}
                  <button
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-800/30 transition-colors text-left"
                    onClick={() => setExpandedScan(isExpanded ? null : scan.timestamp)}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      {scan.netImpact > 0
                        ? <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" />
                        : scan.netImpact < 0
                        ? <ArrowDownRight className="w-4 h-4 text-red-400 shrink-0" />
                        : <Activity className="w-4 h-4 text-slate-400 shrink-0" />
                      }
                      <span className="text-sm text-slate-600 shrink-0">{time}</span>
                      {scan.isPublic && <span className="text-sm px-1 py-0.5 rounded bg-cyan-600/10 text-cyan-500 shrink-0">公共</span>}
                      <span className="text-sm text-slate-300 shrink-0">{(scan.events || []).length} 个信号</span>
                      {scan.serverTokenUsage && scan.serverTokenUsage.totalTokens > 0 ? (
                        <span className="text-sm px-1.5 py-0.5 rounded bg-purple-600/10 text-purple-400 shrink-0 tabular-nums">
                          🔤 {scan.serverTokenUsage.totalTokens.toLocaleString()} tok
                        </span>
                      ) : scan.tokenUsage && scan.tokenUsage.length > 0 ? (
                        <span className="text-sm px-1.5 py-0.5 rounded bg-purple-600/10 text-purple-400 shrink-0 tabular-nums">
                          🔤 {scan.tokenUsage.reduce((s: number, u: any) => s + u.totalTokens, 0).toLocaleString()} tok
                        </span>
                      ) : null}
                      <div className="flex items-center gap-1 min-w-0">
                        {scan.topGroups.map(([gid, cnt]) => {
                          const grp = groupLabel(gid);
                          return (
                            <span key={gid} className="text-sm px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-500 shrink-0">
                              {grp?.icon} {grp?.label?.slice(0, 4)}{cnt > 1 ? ` ×${cnt}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="text-emerald-500">{scan.bullish}📈</span>
                        <span className="text-red-400">{scan.bearish}📉</span>
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${
                        scan.netImpact > 0 ? 'text-emerald-400' : scan.netImpact < 0 ? 'text-red-400' : 'text-slate-500'
                      }`}>
                        {scan.netImpact > 0 ? '+' : ''}{scan.netImpact}
                      </span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                    </div>
                  </button>

                  {/* 展开: 显示该次扫描的所有信号事件 */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/50">
                      {scan.marketSummary && (
                        <div className="px-4 py-3 bg-blue-500/5 border-b border-slate-800/30">
                          <p className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">📊 市场综合分析</p>
                          <p className="text-sm text-slate-300 leading-relaxed">{scan.marketSummary}</p>
                        </div>
                      )}
                      {scan.events.length === 0 && (
                        <div className="px-4 py-4 text-center text-slate-500">
                          <p className="text-sm">🌊 本次扫描未触发任何信号 — 市场平静</p>
                          {scan.scoreDirection !== undefined && (
                            <p className="text-sm mt-1 text-slate-600">
                              SD={scan.scoreDirection?.toFixed(1)} SV={scan.scoreVolatility?.toFixed(1)} SR={scan.scoreRisk?.toFixed(1)}
                            </p>
                          )}
                        </div>
                      )}
                      {scan.events.map((evt) => {
                        const grp = groupLabel(evt.group);
                        return (
                          <div key={evt.id} className="px-4 py-2.5 border-b border-slate-800/30 last:border-b-0 hover:bg-slate-800/20">
                            <div className="flex items-center gap-2">
                              {evt.impact > 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                              <span className="text-sm px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 shrink-0">{grp?.icon} {grp?.label}</span>
                              <span className="text-sm text-slate-600 shrink-0">#{evt.signalId}</span>
                              <span className="font-medium text-sm text-slate-200 truncate flex-1">{evt.title}</span>
                              <span className={`text-sm font-bold tabular-nums shrink-0 ${evt.impact > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {evt.impact > 0 ? '+' : ''}{evt.impact}
                              </span>
                              <span className="text-sm text-slate-600 shrink-0">{(evt.confidence * 100).toFixed(0)}%</span>
                            </div>
                            {evt.summary && (
                              <p className="text-sm text-slate-500 mt-1 ml-5 leading-relaxed">{evt.summary}</p>
                            )}
                          </div>
                        );
                      })}
                      {/* Token 消耗 & 耗时详情 */}
                      {scan.isPublic && scan.serverTokenUsage && scan.serverTokenUsage.totalTokens > 0 ? (
                        <div className="px-4 py-3 bg-slate-800/20 border-t border-slate-700/30">
                          <p className="text-sm text-slate-500 font-medium mb-2 flex items-center gap-1">🔤 服务端 Token 消耗</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <span className="text-slate-500">搜索 Token:</span>
                              <span className="ml-2 font-medium text-blue-400 tabular-nums">{scan.serverTokenUsage.searchTokens.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">分析 Token:</span>
                              <span className="ml-2 font-medium text-purple-400 tabular-nums">{scan.serverTokenUsage.analyzeTokens.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">总 Token:</span>
                              <span className="ml-2 font-semibold text-amber-400 tabular-nums">{scan.serverTokenUsage.totalTokens.toLocaleString()}</span>
                            </div>
                            {scan.startedAt && scan.completedAt && (
                              <div>
                                <span className="text-slate-500">耗时:</span>
                                <span className="ml-2 font-medium text-cyan-400 tabular-nums">
                                  {((new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000).toFixed(1)}s
                                </span>
                              </div>
                            )}
                          </div>
                          {scan.startedAt && (
                            <div className="flex items-center gap-4 mt-2 text-xs text-slate-600">
                              <span>开始: {new Date(scan.startedAt).toLocaleString('zh-CN')}</span>
                              {scan.completedAt && <span>完成: {new Date(scan.completedAt).toLocaleString('zh-CN')}</span>}
                            </div>
                          )}
                        </div>
                      ) : scan.tokenUsage && scan.tokenUsage.length > 0 ? (
                        <div className="px-4 py-3 bg-slate-800/20 border-t border-slate-700/30">
                          <p className="text-sm text-slate-500 font-medium mb-2 flex items-center gap-1">🔤 Token 消耗明细</p>
                          <div className="space-y-1.5">
                            {scan.tokenUsage.map((u: any, i: number) => (
                              <div key={i} className="flex items-center gap-3 text-sm">
                                <span className="text-slate-400 font-medium w-24">{u.provider === 'perplexity' ? '🔍 搜索' : '🧠 分析'}</span>
                                <span className="text-slate-500">{u.provider}/{u.model}</span>
                                <span className="text-slate-600 ml-auto tabular-nums">输入: <span className="text-blue-400">{u.promptTokens.toLocaleString()}</span></span>
                                <span className="text-slate-600 tabular-nums">输出: <span className="text-purple-400">{u.completionTokens.toLocaleString()}</span></span>
                                <span className="text-slate-400 font-bold tabular-nums">合计: {u.totalTokens.toLocaleString()}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between pt-1.5 border-t border-slate-700/30 text-sm">
                              <span className="text-slate-500">总消耗</span>
                              <span className="text-amber-400 font-bold tabular-nums">
                                {scan.tokenUsage.reduce((s: number, u: any) => s + u.totalTokens, 0).toLocaleString()} tokens
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : !scan.isPublic ? (
                        <div className="px-4 py-2 bg-slate-800/20 border-t border-slate-700/30">
                          <p className="text-sm text-slate-600">💡 此次扫描未记录 Token 消耗（旧版扫描记录）</p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右列: 失败记录 */}
        {hasFailures && (
          <div className="space-y-3 min-w-0">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              失败记录
              <span className="text-sm text-red-400/60 font-normal ml-1">({scanFailures!.length} 条)</span>
            </h3>
            <div className="space-y-2">
              {scanFailures!.map((f) => {
                const time = new Date(f.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const isToken = f.reason.includes('Token');
                const isRateLimit = f.reason.includes('频率');
                return (
                  <div key={f.id} className={`rounded-xl border p-3 ${isRateLimit ? 'border-amber-500/20 bg-amber-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className={`w-4 h-4 shrink-0 ${isRateLimit ? 'text-amber-400' : 'text-red-400'}`} />
                      <span className="text-sm text-slate-500 shrink-0">{time}</span>
                      <span className={`text-sm font-medium ${isRateLimit ? 'text-amber-400' : 'text-red-400'}`}>{f.reason}</span>
                      {f.mode === 'public-service' && <span className="text-xs px-1 py-0.5 rounded bg-cyan-600/10 text-cyan-500">公共服务</span>}
                    </div>
                    <p className="text-sm mt-1.5 ml-6">
                      {isToken
                        ? <span className="text-amber-400/80">💡 Token 余额不足，请前往 <a href="http://43.156.216.141:3005/dashboard" target="_blank" rel="noopener noreferrer" className="underline text-cyan-400 hover:text-cyan-300">Sentinel-X 主页</a> 充值</span>
                        : isRateLimit
                        ? <span className="text-amber-400/70">⏱️ 请求频率受限，请联系管理员调高限制或降低扫描频率</span>
                        : f.errorDetail && <span className="text-slate-500">{f.errorDetail}</span>
                      }
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 主组件 ====================
export default function SentimentMonitor() {
  const [scanMode, setScanMode] = useState<ScanMode>('self-hosted');
  const [analyzing, setAnalyzing] = useState(false);
  const analyzingRef = useRef(false);
  const [error, setError] = useState('');
  const [scores, setScores] = useState<ScoringResult | null>(null);
  const [gridParams, setGridParams] = useState<GridAutoParams | null>(null);
  const [marketSummary, setMarketSummary] = useState('');
  const [newAlerts, setNewAlerts] = useState<EventAlert[]>([]);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [pipelineResult, setPipelineResult] = useState<{ hasSearcher: boolean; hasMarketData: boolean; searcherProvider?: string; analyzerProvider: string } | null>(null);
  const [scanResult, setScanResult] = useState<{ success: boolean; signalCount: number; alertCount: number; elapsed: number } | null>(null);
  const scanStartRef = useRef<number>(0);

  // 自动检测模式: 如果有启用的公共服务配置，默认切到公共服务模式
  const publicConfigs = useLiveQuery(() => db.publicServiceConfigs.filter(c => c.enabled).toArray(), []);
  useEffect(() => {
    if (publicConfigs && publicConfigs.length > 0) {
      setScanMode('public-service');
    }
  }, [publicConfigs]);

  // 每次加载时从DB重算评分，但保留最近一次保存的扫描时间戳
  const signalEvents = useLiveQuery(() => db.signalEvents.toArray(), []);
  useEffect(() => {
    if (signalEvents && signalEvents.length > 0) {
      const result = SentinelScoringEngine.calculateScores(signalEvents);
      // 从 DB 恢复最近保存的评分时间戳，避免"扫描于"时间随实时刷新
      db.scoringResults.orderBy('timestamp').reverse().first().then(latest => {
        if (latest) result.timestamp = latest.timestamp;
        setScores(result);
        setGridParams(SentinelScoringEngine.mapToGridParams(result));
      });
    }
  }, [signalEvents]);

  // 每次加载时从DB恢复最新 marketSummary
  useEffect(() => {
    db.scanBriefings.orderBy('receivedAt').reverse().first().then(latest => {
      if (latest?.marketSummary && !marketSummary) {
        setMarketSummary(latest.marketSummary);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 自建模式: 本地 LLM 扫描 =====
  const handleSelfHostedScan = useCallback(async () => {
    if (analyzingRef.current) return; // 防重复
    analyzingRef.current = true;
    setAnalyzing(true);
    setError('');
    setNewAlerts([]);
    setProgress(null);
    setPipelineResult(null);
    setScanResult(null);
    scanStartRef.current = Date.now();
    try {
      // 查找 analyzer (必需)
      let analyzer = (await db.llmConfigs.filter(c => c.enabled && c.role === 'analyzer').toArray())[0];
      if (!analyzer) {
        // 向后兼容: 旧配置无 role 字段
        const anyConfig = (await db.llmConfigs.filter(c => c.enabled).toArray())[0];
        if (!anyConfig) {
          setError('请先配置并启用至少一个「分析 Analyzer」LLM 模型');
          analyzingRef.current = false;
          setAnalyzing(false);
          return;
        }
        if (anyConfig.id && !anyConfig.role) {
          await db.llmConfigs.update(anyConfig.id, { role: 'analyzer' });
          anyConfig.role = 'analyzer';
        }
        analyzer = anyConfig;
      }

      const signalDefs = await db.signalDefinitions.filter(s => s.enabled).toArray();
      if (signalDefs.length === 0) {
        setError('请先启用信号');
        analyzingRef.current = false;
        setAnalyzing(false);
        return;
      }

      const { events, alerts, marketSummary: summary, pipelineInfo, tokenUsage } = await analyzeSignals(
        analyzer,
        signalDefs,
        (p) => setProgress(p),
      );
      await saveSignalEvents(events, alerts);
      setMarketSummary(summary);
      setNewAlerts(alerts);
      setPipelineResult(pipelineInfo);

      // 重算评分
      const allEvents = await db.signalEvents.toArray();
      const result = SentinelScoringEngine.calculateScores(allEvents);
      setScores(result);
      setGridParams(SentinelScoringEngine.mapToGridParams(result));

      // 保存评分快照 (包含 Token 消耗)
      result.tokenUsage = tokenUsage;
      result.scanMode = 'self-hosted';
      await db.scoringResults.add(result);

      // 保存 ScanBriefing 以持久化 marketSummary
      const briefing: ScanBriefing = {
        briefingId: `self-${Date.now()}`,
        mode: 'self-hosted',
        timestamp: result.timestamp,
        receivedAt: Date.now(),
        marketSummary: summary,
        triggeredSignals: events.map(e => ({
          signalId: e.signalId,
          impact: e.impact,
          confidence: e.confidence,
          title: e.title,
          summary: e.summary || '',
          source: e.source,
        })),
        alerts: alerts.map(a => ({
          title: a.title,
          description: a.description,
          level: a.level,
          group: a.group,
          relatedCoins: a.relatedCoins,
          source: a.source,
        })),
        pipelineInfo,
        notified: false,
      };
      await db.scanBriefings.add(briefing);

      // 推送扫描结果和预警到用户配置的通知渠道
      console.log('[SentimentMonitor] 开始推送扫描结果, briefing signals:', briefing.triggeredSignals.length);
      notifyScanResult(briefing, result).then(ch => console.log('[SentimentMonitor] 推送完成, 成功渠道:', ch)).catch((err: any) => console.warn('推送扫描结果失败:', err));
      for (const a of alerts) {
        notifyAlert(a).catch((err: any) => console.warn('推送预警失败:', err));
      }

      const elapsed = Math.round((Date.now() - scanStartRef.current) / 1000);
      setScanResult({ success: true, signalCount: events.length, alertCount: alerts.length, elapsed });
    } catch (err: any) {
      setError(`分析失败: ${err.message}`);
      setScanResult({ success: false, signalCount: 0, alertCount: 0, elapsed: Math.round((Date.now() - scanStartRef.current) / 1000) });
    }
    analyzingRef.current = false;
    setAnalyzing(false);
    setProgress(null);
  }, []);

  // ===== 公共服务模式: 请求服务端扫描 =====
  const handlePublicScan = useCallback(async () => {
    if (analyzingRef.current) return; // 防重复
    analyzingRef.current = true;
    setAnalyzing(true);
    setError('');
    setNewAlerts([]);
    setPipelineResult(null);
    setScanResult(null);
    scanStartRef.current = Date.now();
    try {
      const config = (await db.publicServiceConfigs.filter(c => c.enabled).toArray())[0];
      if (!config) {
        setError('请先配置并启用公共扫描服务');
        analyzingRef.current = false;
        setAnalyzing(false);
        return;
      }

      setProgress({ step: 0, totalSteps: 2, label: '📡 请求服务端扫描', detail: config.serverUrl });
      const { briefingId, estimatedSeconds } = await requestScan(config);

      setProgress({ step: 1, totalSteps: 2, label: '⏳ 等待扫描结果', detail: `预计 ${estimatedSeconds}s (${briefingId.slice(0, 8)}...)` });

      // 轮询等待结果 (最多等待 estimatedSeconds * 2)
      const maxWait = Math.max(60, (estimatedSeconds || 30) * 2) * 1000;
      const start = Date.now();
      let briefing: ScanBriefing | null = null;

      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 3000));
        const briefings = await fetchLatestBriefings(config, 1);
        if (briefings.length > 0 && briefings[0].briefingId === briefingId) {
          briefing = briefings[0];
          break;
        }
      }

      if (!briefing) {
        setError('扫描超时，简报可能稍后通过 SSE 推送到达');
        analyzingRef.current = false;
        setAnalyzing(false);
        setProgress(null);
        return;
      }

      // 保存并处理简报 (使用服务端真实完成时间作为时间戳)
      const scanTimestamp = briefing.completedAt ? new Date(briefing.completedAt).getTime() : briefing.timestamp;
      const saved = await saveBriefing(briefing, scanTimestamp);
      setMarketSummary(briefing.marketSummary);
      setNewAlerts(saved.alerts);
      setPipelineResult(briefing.pipelineInfo);

      // 自动通知
      if (config.notifyEnabled && briefing.alerts.length > 0) {
        await notifyBriefing(briefing);
      }

      // 重算评分 (使用服务端真实完成时间作为时间戳)
      const allEvents = await db.signalEvents.toArray();
      const result = SentinelScoringEngine.calculateScores(allEvents);
      result.timestamp = scanTimestamp;
      result.scanMode = 'public-service';
      if (briefing.serverTokenUsage) result.serverTokenUsage = briefing.serverTokenUsage;
      if (briefing.startedAt) result.serverStartedAt = briefing.startedAt;
      if (briefing.completedAt) result.serverCompletedAt = briefing.completedAt;
      setScores(result);
      setGridParams(SentinelScoringEngine.mapToGridParams(result));
      await db.scoringResults.add(result);

      // 推送扫描结果到用户配置的通知渠道
      notifyScanResult(briefing, result).catch((err: any) => console.warn('推送扫描结果失败:', err));
    } catch (err: any) {
      setError(`公共服务扫描失败: ${err.message}`);
    }
    analyzingRef.current = false;
    setAnalyzing(false);
    setProgress(null);
  }, []);

  const handleScan = scanMode === 'self-hosted' ? handleSelfHostedScan : handlePublicScan;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            🛡️ <span className="bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">Sentinel-X 信号监控</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {scanMode === 'self-hosted'
              ? '实时数据采集 → 联网搜索 → 300信号分析 → 三大指数 → 网格调参'
              : '公共服务推送简报 → 300信号评分 → 三大指数 → 网格调参 → 社交通知'}
          </p>
        </div>
      </div>

      {/* 扫描进度条 — 醒目持续显示 */}
      {analyzing && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(59,130,246,0.08) 100%)', border: '1px solid rgba(139,92,246,0.25)' }}>
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
              <div className="absolute inset-0 rounded-full border-2 border-purple-500/30 border-t-purple-400 animate-spin" />
              <Radio className="w-4 h-4 text-purple-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-purple-300">
                  {scanMode === 'self-hosted' ? '🔍 自建模式扫描中' : '📡 公共服务扫描中'}
                </span>
                <span className="text-sm text-slate-500">—</span>
                <span className="text-sm text-slate-400">
                  {progress ? progress.label : (scanMode === 'public-service' ? '连接公共服务...' : '初始化管线...')}
                </span>
              </div>
              {progress && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
                      style={{ width: `${Math.max(5, ((progress.step + 1) / progress.totalSteps) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-500 tabular-nums shrink-0">{progress.step + 1}/{progress.totalSteps}</span>
                </div>
              )}
              {progress?.detail && <p className="text-sm text-slate-500 mt-0.5 truncate">{progress.detail}</p>}
            </div>
          </div>
        </div>
      )}

      {/* 扫描完成提示 */}
      {scanResult && !analyzing && (
        <div className={`rounded-xl overflow-hidden transition-all ${scanResult.success
          ? 'border border-emerald-500/25'
          : 'border border-red-500/25'
        }`} style={{ background: scanResult.success
          ? 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(15,23,42,0.4) 100%)'
          : 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(15,23,42,0.4) 100%)'
        }}>
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg">{scanResult.success ? '✅' : '❌'}</span>
              <div>
                <p className={`text-sm font-semibold ${scanResult.success ? 'text-emerald-300' : 'text-red-300'}`}>
                  {scanResult.success
                    ? `扫描完成 — 发现 ${scanResult.signalCount} 个信号${scanResult.alertCount > 0 ? `，${scanResult.alertCount} 条预警` : ''}`
                    : '扫描失败'
                  }
                </p>
                <p className="text-sm text-slate-500">
                  耗时 {scanResult.elapsed}s
                  {scanResult.success && scanResult.signalCount === 0 && ' — 当前市场平静，未触发任何信号'}
                </p>
              </div>
            </div>
            <button className="text-slate-500 hover:text-slate-300 p-1" onClick={() => setScanResult(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Pipeline 结果摘要 */}
      {pipelineResult && !analyzing && (
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="flex items-center gap-1">{pipelineResult.hasMarketData ? '✅' : '⚠️'} 实时数据</span>
          <span className="flex items-center gap-1">{pipelineResult.hasSearcher ? `✅ 搜索(${LLM_PROVIDERS[pipelineResult.searcherProvider as LLMProvider]?.name || pipelineResult.searcherProvider || '?'})` : '⏭️ 搜索(未配置)'}</span>
          <span className="flex items-center gap-1">✅ 分析({LLM_PROVIDERS[pipelineResult.analyzerProvider as LLMProvider]?.name || pipelineResult.analyzerProvider || '?'})</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl text-sm text-red-400" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(239,68,68,0.15)' }}>{error}</div>
      )}

      {/* 评分仪表盘 + 网格调参 */}
      <ScoringDashboard scores={scores} gridParams={gridParams} marketSummary={marketSummary} />

      {/* 新预警 */}
      {newAlerts.length > 0 && (
        <div className="card border-red-500/30 space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            检测到 {newAlerts.length} 个预警事件
          </h3>
          {newAlerts.map((alert, i) => (
            <div key={i} className="p-4 rounded-xl" style={alert.level === 'critical' ? { background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(239,68,68,0.18)' } : alert.level === 'warning' ? { background: 'linear-gradient(135deg, rgba(234,179,8,0.08) 0%, rgba(15,23,42,0.4) 100%)', border: '1px solid rgba(234,179,8,0.18)' } : { background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(51,65,85,0.3)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${alert.level === 'critical' ? 'bg-red-600/20 text-red-400' : alert.level === 'warning' ? 'bg-amber-600/20 text-amber-400' : 'bg-slate-700 text-slate-400'}`}>
                  {alert.level === 'critical' ? '🚨 紧急' : alert.level === 'warning' ? '⚠️ 警告' : 'ℹ️ 信息'}
                </span>
                <span className="font-medium text-sm">{alert.title}</span>
              </div>
              <p className="text-sm text-slate-400">{alert.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {alert.relatedCoins.map(c => (
                  <span key={c} className="text-sm px-1.5 py-0.5 rounded bg-blue-600/10 text-blue-400">{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 自动扫描 (全局, 始终可见) */}
      <AutoScanPanel analyzing={analyzing} />

      {/* 管线配置 (双模式) */}
      <PipelineConfigPanel scanMode={scanMode} onModeChange={setScanMode} />

      {/* 信号矩阵 */}
      <SignalMatrixPanel onScan={handleScan} analyzing={analyzing} progress={progress} />

      {/* 信号事件历史 */}
      <SignalEventHistory />
    </div>
  );
}
