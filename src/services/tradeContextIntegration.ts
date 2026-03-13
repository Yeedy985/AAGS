/**
 * Trade Context Integration — 交易状态机与扫描流程的集成层
 * 
 * 在每次扫描评分完成后调用 evaluateAfterScan()，
 * 自动更新交易上下文，输出状态变化和建议。
 * 
 * 这是一个轻量集成层，不修改现有扫描逻辑，只在评分后"挂钩"。
 */

import { db } from '../db';
import type { ScoringResult, SignalEvent, TradeSuggestion } from '../types';
import {
  evaluateContext,
  validateSuggestion,
  formatContextSummary,
  getActiveContexts,
} from './tradeStateMachine';
import { fetchKlines } from './technicalAnalysis';

// 默认关注的交易对
const WATCHED_COINS = ['BTCUSDT'];

/**
 * 扫描后评估 — 每次扫描评分完成后调用
 * 
 * @param scores 最新评分结果
 * @param activeEvents 当前活跃信号
 * @param tradeSuggestions LLM 给出的交易建议 (Phase 1.5)
 * @returns 状态变化摘要 (可用于通知)
 */
export async function evaluateAfterScan(
  scores: ScoringResult,
  activeEvents?: SignalEvent[],
  tradeSuggestions?: TradeSuggestion[],
): Promise<{ summaries: string[]; hasChanges: boolean }> {
  const summaries: string[] = [];
  let hasChanges = false;

  // 如果没传活跃事件，从DB读取
  if (!activeEvents) {
    activeEvents = await db.signalEvents.toArray();
  }

  for (const coin of WATCHED_COINS) {
    try {
      // 获取当前价格 (快速获取，不获取完整K线)
      let currentPrice = 0;
      try {
        const klines = await fetchKlines(coin, '1m', 1);
        if (klines.length > 0) currentPrice = klines[klines.length - 1].close;
      } catch {
        // 价格获取失败不阻断状态机
      }

      // 查找该币种的 LLM 建议，并通过风控校验
      let validSuggestion: TradeSuggestion | undefined;
      if (tradeSuggestions && currentPrice > 0) {
        const coinSuggestion = tradeSuggestions.find(s => s.coin === coin || s.coin === coin.replace('USDT', ''));
        if (coinSuggestion) {
          const validated = validateSuggestion(coinSuggestion, currentPrice, scores);
          if (validated) {
            validSuggestion = validated;
            console.log(`[TradeContext] ${coin} LLM建议通过风控: ${validated.action} @ $${validated.entryPrice}`);
          }
        }
      }

      const { ctx, changed, shouldNotify } = await evaluateContext(
        coin,
        activeEvents,
        scores,
        currentPrice,
        validSuggestion,
      );

      if (changed) {
        hasChanges = true;
        const summary = formatContextSummary(ctx);
        summaries.push(summary);

        if (shouldNotify) {
          console.log(`[TradeContext] ${coin} 状态变化需通知:\n${summary}`);
        }
      }
    } catch (e: any) {
      console.warn(`[TradeContext] ${coin} 评估失败:`, e.message);
    }
  }

  return { summaries, hasChanges };
}

/**
 * 获取所有活跃交易上下文的摘要 (用于UI显示)
 */
export async function getActiveContextSummaries(): Promise<string[]> {
  const contexts = await getActiveContexts();
  return contexts.map(ctx => formatContextSummary(ctx));
}

export { validateSuggestion, getActiveContexts };
