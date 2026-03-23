/**
 * 后台心跳服务
 * 
 * 只要 AAGS 打开就持续为所有已分享的策略发送心跳，
 * 不依赖策略执行引擎或特定页面可见。
 * 在 App.tsx 层面 useEffect 启动。
 */
import { sendHeartbeat, syncStrategyData } from './strategyPlazaService';
import { db } from '../db';

const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 每 2 分钟
const SYNC_INTERVAL = 5 * 60 * 1000; // 每 5 分钟同步收益数据

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastSync: Record<string, number> = {};

function getShareCodes(): Record<string, string> {
  try {
    const saved = localStorage.getItem('aags_share_codes');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

async function doHeartbeatRound() {
  const shareCodes = getShareCodes();
  const entries = Object.entries(shareCodes);
  if (entries.length === 0) return;

  const now = Date.now();

  for (const [strategyIdStr, shareCode] of entries) {
    const strategyId = Number(strategyIdStr);

    // 心跳 (fire-and-forget)
    sendHeartbeat(shareCode);

    // 数据同步 (每 5 分钟)
    const lastSync = _lastSync[shareCode] || 0;
    if (now - lastSync >= SYNC_INTERVAL) {
      try {
        const strategy = await db.strategies.get(strategyId);
        if (strategy) {
          const totalGridCount = (strategy.layers || []).filter(l => l.enabled).reduce((a, l) => a + (l.gridCount || 0), 0);
          const pnlPct = strategy.totalFund > 0 ? (strategy.totalProfit / strategy.totalFund * 100) : 0;
          const runSec = strategy.startedAt ? Math.floor((now - strategy.startedAt) / 1000) : 0;

          await syncStrategyData(shareCode, {
            pnlUsdt: strategy.totalProfit,
            pnlPercent: pnlPct,
            runSeconds: runSec,
            matchCount: strategy.winTrades,
            totalGrids: totalGridCount,
            maxDrawdownPct: strategy.maxDrawdown,
            isRunning: strategy.status === 'running',
          });
          _lastSync[shareCode] = now;
        }
      } catch {
        // 同步失败不影响心跳
      }
    }
  }
}

/** 启动后台心跳服务 */
export function startHeartbeatService() {
  if (_timer) return; // 已在运行
  console.log('[心跳服务] 已启动，每 2 分钟为已分享策略发送心跳');

  // 启动后立即执行一次
  doHeartbeatRound();

  _timer = setInterval(doHeartbeatRound, HEARTBEAT_INTERVAL);
}

/** 停止后台心跳服务 */
export function stopHeartbeatService() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    _lastSync = {};
    console.log('[心跳服务] 已停止');
  }
}
