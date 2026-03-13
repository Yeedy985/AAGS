/**
 * Trade State Machine — 交易状态机 (Phase 0.5)
 * 
 * 核心目标: 让系统有"记忆"，避免每次扫描从零开始
 * 
 * 状态流转:
 *   WAITING → PRE_ENTRY → IN_TRADE → EXIT_READY → COOLDOWN → WAITING
 *                ↑                       ↓
 *                └───────────────────────┘ (信号反转直接退出)
 * 
 * 去噪机制:
 * - 信号组合 hash: 如果活跃信号没变，不重复发建议
 * - 状态锁定: IN_TRADE 状态下，只有触及止损/止盈/信号反转才会改变
 * - 冷却期: 退出后等待一段时间，避免"追涨杀跌"
 * 
 * 设计原则: "系统有记忆，不因小波动频繁改变建议"
 */

import { db } from '../db';
import type {
  TradeContext, TradeState, TradeStateTransition,
  TradeSuggestion, ScoringResult, SignalEvent,
} from '../types';

// ==================== 配置常量 ====================

const CONFIG = {
  // 状态超时 (ms)
  PRE_ENTRY_TIMEOUT: 4 * 60 * 60 * 1000,   // PRE_ENTRY 4小时未入场自动回 WAITING
  IN_TRADE_TIMEOUT: 72 * 60 * 60 * 1000,    // IN_TRADE 72小时自动超时
  COOLDOWN_DURATION: 30 * 60 * 1000,         // COOLDOWN 30分钟冷却
  // 信号去噪
  SIGNAL_CHANGE_THRESHOLD: 0.3,              // 信号 hash 变化超过30%才视为"有变化"
  // 入场条件
  MIN_CONFIDENCE_FOR_ENTRY: 0.6,             // 建议信心 > 60% 才进入 PRE_ENTRY
  // 退出条件
  SIGNAL_REVERSAL_SD_THRESHOLD: 30,          // SD 从正翻负超过30分视为信号反转
  STOP_LOSS_MAX_PERCENT: 5,                  // 止损最大幅度 5%
};

// ==================== 信号 Hash (去噪核心) ====================

/**
 * 计算活跃信号的"指纹" hash
 * 用于判断两次扫描之间信号组合是否发生了实质性变化
 */
export function computeSignalHash(events: SignalEvent[], scores: ScoringResult): string {
  // 组合: 活跃信号ID排序 + SD/SV/SR 量化桶
  const signalIds = events
    .map(e => e.signalId)
    .sort((a, b) => a - b)
    .join(',');

  // SD 量化到 10 分一档, SV/SR 量化到 15 分一档
  const sdBucket = Math.round(scores.scoreDirection / 10) * 10;
  const svBucket = Math.round(scores.scoreVolatility / 15) * 15;
  const srBucket = Math.round(scores.scoreRisk / 15) * 15;

  return `${signalIds}|${sdBucket}|${svBucket}|${srBucket}`;
}

/**
 * 判断两个 hash 之间的变化程度 (0-1)
 */
function hashChangeRatio(oldHash: string, newHash: string): number {
  if (oldHash === newHash) return 0;
  if (!oldHash || !newHash) return 1;

  const oldParts = oldHash.split('|');
  const newParts = newHash.split('|');

  // 比较信号ID集合的 Jaccard 距离
  const oldIds = new Set((oldParts[0] || '').split(',').filter(Boolean));
  const newIds = new Set((newParts[0] || '').split(',').filter(Boolean));
  const union = new Set([...oldIds, ...newIds]);
  const intersection = [...oldIds].filter(id => newIds.has(id));
  const jaccardDist = union.size > 0 ? 1 - intersection.length / union.size : 0;

  // 比较评分桶的变化
  const scoreDiffs = [1, 2, 3].map(i => {
    const oldVal = Number(oldParts[i]) || 0;
    const newVal = Number(newParts[i]) || 0;
    return Math.abs(oldVal - newVal) / 100;
  });
  const avgScoreDiff = scoreDiffs.reduce((a, b) => a + b, 0) / 3;

  return Math.min(1, jaccardDist * 0.6 + avgScoreDiff * 0.4);
}

// ==================== 状态机核心 ====================

/**
 * 获取或创建某个币的交易上下文
 */
export async function getOrCreateContext(coin: string): Promise<TradeContext> {
  const existing = await db.tradeContexts.where('coin').equals(coin).first();
  if (existing) return existing;

  const now = Date.now();
  const ctx: TradeContext = {
    coin,
    state: 'WAITING',
    stateEnteredAt: now,
    lastEvaluatedAt: now,
    lastSignalHash: '',
    stateHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  ctx.id = await db.tradeContexts.add(ctx);
  return ctx;
}

/**
 * 状态转换 (带历史记录)
 */
function transition(
  ctx: TradeContext,
  newState: TradeState,
  reason: string,
  scores?: ScoringResult,
): void {
  const now = Date.now();
  const trans: TradeStateTransition = {
    from: ctx.state,
    to: newState,
    reason,
    timestamp: now,
    scoreSnapshot: scores ? {
      sd: scores.scoreDirection,
      sv: scores.scoreVolatility,
      sr: scores.scoreRisk,
    } : undefined,
  };

  ctx.stateHistory.push(trans);
  // 只保留最近 50 条转换记录
  if (ctx.stateHistory.length > 50) {
    ctx.stateHistory = ctx.stateHistory.slice(-50);
  }

  console.log(`[StateMachine] ${ctx.coin}: ${ctx.state} → ${newState} | ${reason}`);
  ctx.state = newState;
  ctx.stateEnteredAt = now;
  ctx.updatedAt = now;
}

/**
 * 主评估函数 — 每次扫描后调用
 * 
 * 输入: 当前活跃信号 + 评分 + 当前价格 + LLM建议(可选)
 * 输出: 更新后的 TradeContext (含是否需要发送新建议)
 */
export async function evaluateContext(
  coin: string,
  activeEvents: SignalEvent[],
  scores: ScoringResult,
  currentPrice: number,
  llmSuggestion?: TradeSuggestion,
): Promise<{ ctx: TradeContext; changed: boolean; shouldNotify: boolean }> {
  const ctx = await getOrCreateContext(coin);
  const now = Date.now();
  const newHash = computeSignalHash(activeEvents, scores);
  const changeRatio = hashChangeRatio(ctx.lastSignalHash, newHash);

  let changed = false;
  let shouldNotify = false;

  // ===== 超时检查 (所有状态通用) =====
  const stateAge = now - ctx.stateEnteredAt;

  switch (ctx.state) {
    // ==================== WAITING ====================
    case 'WAITING': {
      // 条件: 有强方向信号 + 低风险 → 进入 PRE_ENTRY
      const hasDirection = Math.abs(scores.scoreDirection) > 25;
      const lowRisk = scores.scoreRisk < 60;
      const hasSuggestion = llmSuggestion && llmSuggestion.confidence >= CONFIG.MIN_CONFIDENCE_FOR_ENTRY;

      if (hasDirection && lowRisk && hasSuggestion) {
        transition(ctx, 'PRE_ENTRY', `SD=${scores.scoreDirection.toFixed(0)} SR=${scores.scoreRisk.toFixed(0)} 方向明确+风险可控`, scores);
        ctx.suggestion = llmSuggestion;
        changed = true;
        shouldNotify = true;
      }
      break;
    }

    // ==================== PRE_ENTRY ====================
    case 'PRE_ENTRY': {
      // 超时: 回到 WAITING
      if (stateAge > CONFIG.PRE_ENTRY_TIMEOUT) {
        transition(ctx, 'WAITING', 'PRE_ENTRY超时(4h未入场)', scores);
        ctx.suggestion = undefined;
        changed = true;
        break;
      }

      // 信号反转: 回到 WAITING
      if (ctx.suggestion) {
        const wasLong = ctx.suggestion.action === 'BUY';
        const nowBearish = scores.scoreDirection < -CONFIG.SIGNAL_REVERSAL_SD_THRESHOLD;
        const nowBullish = scores.scoreDirection > CONFIG.SIGNAL_REVERSAL_SD_THRESHOLD;

        if ((wasLong && nowBearish) || (!wasLong && nowBullish)) {
          transition(ctx, 'WAITING', `信号反转: SD=${scores.scoreDirection.toFixed(0)}`, scores);
          ctx.suggestion = undefined;
          changed = true;
          shouldNotify = true;
          break;
        }
      }

      // 价格触及入场价: 模拟入场 → IN_TRADE
      if (ctx.suggestion && currentPrice > 0) {
        const entry = ctx.suggestion.entryPrice;
        const tolerance = entry * 0.003; // 0.3% 容差
        if (Math.abs(currentPrice - entry) <= tolerance) {
          transition(ctx, 'IN_TRADE', `价格触及入场位 $${entry}`, scores);
          ctx.entryPrice = currentPrice;
          ctx.entryTime = now;
          ctx.targetPrice = ctx.suggestion.targetPrice;
          ctx.stopLoss = ctx.suggestion.stopLoss;
          ctx.peakPrice = currentPrice;
          ctx.troughPrice = currentPrice;
          changed = true;
          shouldNotify = true;
        }
      }

      // 信号有显著变化: 更新建议
      if (!changed && changeRatio > CONFIG.SIGNAL_CHANGE_THRESHOLD && llmSuggestion) {
        ctx.suggestion = llmSuggestion;
        changed = true;
        shouldNotify = true;
      }
      break;
    }

    // ==================== IN_TRADE ====================
    case 'IN_TRADE': {
      // 更新峰值/谷值
      if (currentPrice > 0) {
        if (!ctx.peakPrice || currentPrice > ctx.peakPrice) ctx.peakPrice = currentPrice;
        if (!ctx.troughPrice || currentPrice < ctx.troughPrice) ctx.troughPrice = currentPrice;
      }

      // 超时退出
      if (stateAge > CONFIG.IN_TRADE_TIMEOUT) {
        transition(ctx, 'EXIT_READY', '持仓超时(72h)', scores);
        ctx.exitReason = 'TIMEOUT';
        changed = true;
        shouldNotify = true;
        break;
      }

      // 止盈检查
      if (ctx.targetPrice && currentPrice > 0) {
        const isLong = (ctx.suggestion?.action === 'BUY');
        const targetHit = isLong
          ? currentPrice >= ctx.targetPrice
          : currentPrice <= ctx.targetPrice;

        if (targetHit) {
          transition(ctx, 'EXIT_READY', `目标价触及 $${ctx.targetPrice}`, scores);
          ctx.exitPrice = currentPrice;
          ctx.exitTime = now;
          ctx.exitReason = 'TARGET_HIT';
          changed = true;
          shouldNotify = true;
          break;
        }
      }

      // 止损检查
      if (ctx.stopLoss && currentPrice > 0) {
        const isLong = (ctx.suggestion?.action === 'BUY');
        const stopHit = isLong
          ? currentPrice <= ctx.stopLoss
          : currentPrice >= ctx.stopLoss;

        if (stopHit) {
          transition(ctx, 'EXIT_READY', `止损触发 $${ctx.stopLoss}`, scores);
          ctx.exitPrice = currentPrice;
          ctx.exitTime = now;
          ctx.exitReason = 'STOP_LOSS';
          changed = true;
          shouldNotify = true;
          break;
        }
      }

      // 信号反转检查 (IN_TRADE 时更严格)
      if (ctx.suggestion) {
        const wasLong = ctx.suggestion.action === 'BUY';
        const strongReversal = wasLong
          ? scores.scoreDirection < -40
          : scores.scoreDirection > 40;

        if (strongReversal && scores.scoreRisk > 70) {
          transition(ctx, 'EXIT_READY', `强信号反转 SD=${scores.scoreDirection.toFixed(0)} SR=${scores.scoreRisk.toFixed(0)}`, scores);
          ctx.exitPrice = currentPrice;
          ctx.exitTime = now;
          ctx.exitReason = 'SIGNAL_REVERSAL';
          changed = true;
          shouldNotify = true;
          break;
        }
      }

      // IN_TRADE 状态: 不因小波动改变建议，只输出持仓状态
      break;
    }

    // ==================== EXIT_READY ====================
    case 'EXIT_READY': {
      // 自动进入冷却
      transition(ctx, 'COOLDOWN', `退出完成 (${ctx.exitReason || 'unknown'})`, scores);
      changed = true;
      break;
    }

    // ==================== COOLDOWN ====================
    case 'COOLDOWN': {
      if (stateAge > CONFIG.COOLDOWN_DURATION) {
        transition(ctx, 'WAITING', '冷却完成', scores);
        // 清除旧建议数据
        ctx.suggestion = undefined;
        ctx.entryPrice = undefined;
        ctx.entryTime = undefined;
        ctx.targetPrice = undefined;
        ctx.stopLoss = undefined;
        ctx.exitPrice = undefined;
        ctx.exitTime = undefined;
        ctx.exitReason = undefined;
        ctx.peakPrice = undefined;
        ctx.troughPrice = undefined;
        changed = true;
      }
      break;
    }
  }

  // 更新元数据
  ctx.lastEvaluatedAt = now;
  ctx.lastSignalHash = newHash;
  ctx.updatedAt = now;

  // 持久化
  if (ctx.id) {
    await db.tradeContexts.put(ctx);
  }

  return { ctx, changed, shouldNotify };
}

// ==================== 风控校验 ====================

/**
 * 校验 LLM 给出的交易建议是否合理
 * 返回校验后的建议 (可能修正止损) 或 null (不合理)
 */
export function validateSuggestion(
  suggestion: TradeSuggestion,
  currentPrice: number,
  scores: ScoringResult,
): TradeSuggestion | null {
  const { action, entryPrice, targetPrice, stopLoss, confidence } = suggestion;

  // 1. 信心度检查
  if (confidence < CONFIG.MIN_CONFIDENCE_FOR_ENTRY) {
    console.log(`[风控] 信心度过低: ${confidence} < ${CONFIG.MIN_CONFIDENCE_FOR_ENTRY}`);
    return null;
  }

  // 2. 方向一致性: BUY 建议需要 SD > 0, SELL 建议需要 SD < 0
  if (action === 'BUY' && scores.scoreDirection < -20) {
    console.log(`[风控] BUY建议但SD为负 (${scores.scoreDirection.toFixed(0)})，拒绝`);
    return null;
  }
  if (action === 'SELL' && scores.scoreDirection > 20) {
    console.log(`[风控] SELL建议但SD为正 (${scores.scoreDirection.toFixed(0)})，拒绝`);
    return null;
  }

  // 3. 高风险环境下降低信心
  let adjustedConfidence = confidence;
  if (scores.scoreRisk > 70) {
    adjustedConfidence *= 0.7;
    if (adjustedConfidence < CONFIG.MIN_CONFIDENCE_FOR_ENTRY) {
      console.log(`[风控] SR过高(${scores.scoreRisk.toFixed(0)})，调整后信心不足`);
      return null;
    }
  }

  // 4. 止损幅度检查
  const stopLossPercent = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
  let adjustedStopLoss = stopLoss;
  if (stopLossPercent > CONFIG.STOP_LOSS_MAX_PERCENT) {
    // 强制收紧止损到最大允许幅度
    adjustedStopLoss = action === 'BUY'
      ? entryPrice * (1 - CONFIG.STOP_LOSS_MAX_PERCENT / 100)
      : entryPrice * (1 + CONFIG.STOP_LOSS_MAX_PERCENT / 100);
    console.log(`[风控] 止损过宽 ${stopLossPercent.toFixed(1)}%，收紧到 ${CONFIG.STOP_LOSS_MAX_PERCENT}%`);
  }

  // 5. 盈亏比检查 (最低 1.5:1)
  const reward = Math.abs(targetPrice - entryPrice);
  const risk = Math.abs(entryPrice - adjustedStopLoss);
  const rrRatio = risk > 0 ? reward / risk : 0;
  if (rrRatio < 1.5) {
    console.log(`[风控] 盈亏比过低: ${rrRatio.toFixed(2)} < 1.5`);
    return null;
  }

  // 6. 入场价与当前价偏离检查 (不超过3%)
  const entryDeviation = Math.abs(entryPrice - currentPrice) / currentPrice * 100;
  if (entryDeviation > 3) {
    console.log(`[风控] 入场价偏离当前价 ${entryDeviation.toFixed(1)}%，过远`);
    return null;
  }

  return {
    ...suggestion,
    stopLoss: Math.round(adjustedStopLoss * 100) / 100,
    confidence: Math.round(adjustedConfidence * 100) / 100,
  };
}

// ==================== 格式化输出 ====================

/**
 * 生成当前交易状态的摘要文本 (用于 UI 显示)
 */
export function formatContextSummary(ctx: TradeContext): string {
  const stateEmoji: Record<TradeState, string> = {
    'WAITING': '⏳',
    'PRE_ENTRY': '🎯',
    'IN_TRADE': '📊',
    'EXIT_READY': '🚪',
    'COOLDOWN': '❄️',
  };

  const stateLabel: Record<TradeState, string> = {
    'WAITING': '观望中',
    'PRE_ENTRY': '预警入场',
    'IN_TRADE': '持仓中',
    'EXIT_READY': '准备退出',
    'COOLDOWN': '冷却期',
  };

  let text = `${stateEmoji[ctx.state]} ${ctx.coin} — ${stateLabel[ctx.state]}`;

  if (ctx.state === 'PRE_ENTRY' && ctx.suggestion) {
    const s = ctx.suggestion;
    text += `\n${s.action} @ $${s.entryPrice.toLocaleString()} → 目标 $${s.targetPrice.toLocaleString()} | 止损 $${s.stopLoss.toLocaleString()}`;
    text += `\n信心: ${(s.confidence * 100).toFixed(0)}% | ${s.timeframe} | ${s.anchorSource}`;
    text += `\n理由: ${s.reasoning}`;
  }

  if (ctx.state === 'IN_TRADE') {
    if (ctx.entryPrice) {
      text += `\n入场: $${ctx.entryPrice.toLocaleString()}`;
      if (ctx.targetPrice) text += ` → 目标 $${ctx.targetPrice.toLocaleString()}`;
      if (ctx.stopLoss) text += ` | 止损 $${ctx.stopLoss.toLocaleString()}`;
    }
    if (ctx.peakPrice && ctx.troughPrice) {
      text += `\n区间: $${ctx.troughPrice.toLocaleString()} ~ $${ctx.peakPrice.toLocaleString()}`;
    }
    const holdingMs = Date.now() - (ctx.entryTime || ctx.stateEnteredAt);
    const holdingHours = Math.round(holdingMs / 3600000 * 10) / 10;
    text += `\n持仓时长: ${holdingHours}h`;
  }

  if (ctx.state === 'COOLDOWN') {
    const remaining = CONFIG.COOLDOWN_DURATION - (Date.now() - ctx.stateEnteredAt);
    if (remaining > 0) {
      text += ` (${Math.ceil(remaining / 60000)}min 后恢复)`;
    }
    if (ctx.exitReason) {
      const reasonLabel: Record<string, string> = {
        'TARGET_HIT': '✅ 止盈',
        'STOP_LOSS': '❌ 止损',
        'SIGNAL_REVERSAL': '🔄 信号反转',
        'TIMEOUT': '⏰ 超时',
        'MANUAL': '👤 手动',
      };
      text += `\n退出原因: ${reasonLabel[ctx.exitReason] || ctx.exitReason}`;
      if (ctx.entryPrice && ctx.exitPrice) {
        const pnl = ((ctx.exitPrice - ctx.entryPrice) / ctx.entryPrice * 100);
        text += ` | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
      }
    }
  }

  return text;
}

/**
 * 获取所有活跃的交易上下文 (非 WAITING 状态)
 */
export async function getActiveContexts(): Promise<TradeContext[]> {
  return db.tradeContexts
    .where('state')
    .notEqual('WAITING')
    .toArray();
}

/**
 * 获取所有交易上下文
 */
export async function getAllContexts(): Promise<TradeContext[]> {
  return db.tradeContexts.orderBy('updatedAt').reverse().toArray();
}
