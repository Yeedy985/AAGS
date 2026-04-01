import { db } from '../db';
import { placeOrder, getPrice, cancelOrder, setCurrentExchange, getKlines, queryOrder, getAllOrders, getExchangeInfo, getMyTrades, getOpenOrders } from './binance';
import { generateGridOrders, detectTrend, formatQuantity, formatPrice } from './gridEngine';
import { syncStrategyData, sendHeartbeat } from './strategyPlazaService';
import type { Strategy, GridOrder, ApiConfig, SymbolInfo } from '../types';

// ==================== 执行引擎状态 ====================
interface ExecutorState {
  intervalId: ReturnType<typeof setInterval> | null;
  running: boolean;
}

const _executors: Map<number, ExecutorState> = new Map();
const _checkLocks: Map<number, boolean> = new Map(); // 防并发锁
const _lastPlazaSync: Map<number, number> = new Map(); // 策略广场上次同步时间
const PLAZA_SYNC_INTERVAL = 5 * 60 * 1000; // 每 5 分钟同步一次
const _lastHeartbeat: Map<number, number> = new Map(); // 策略广场上次心跳时间
const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 每 2 分钟发送一次心跳
const _lastGridIntegrityCheck: Map<number, number> = new Map(); // 网格完整性上次检查时间
const GRID_INTEGRITY_INTERVAL = 60 * 1000; // 每 60 秒做一次完整网格补齐检查
let _onStrategyUpdate: ((strategy: Strategy) => void) | null = null;
let _onLog: ((strategyId: number, msg: string) => void) | null = null;

export function setExecutorCallbacks(opts: {
  onStrategyUpdate: (strategy: Strategy) => void;
  onLog?: (strategyId: number, msg: string) => void;
}) {
  _onStrategyUpdate = opts.onStrategyUpdate;
  _onLog = opts.onLog || null;
}

function log(strategyId: number, msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[Strategy${strategyId}][${ts}] ${msg}`);
  _onLog?.(strategyId, msg);
}

// 获取某个订单的手续费（从 myTrades 接口）
async function fetchOrderFee(apiKey: string, apiSecret: string, symbol: string, orderId: string): Promise<{ fee: number; feeAsset: string }> {
  try {
    const trades = await getMyTrades(apiKey, apiSecret, symbol, orderId);
    if (!trades || trades.length === 0) return { fee: 0, feeAsset: 'USDT' };
    let totalFee = 0;
    let feeAsset = 'USDT';
    for (const t of trades) {
      totalFee += parseFloat(t.commission || '0');
      feeAsset = t.commissionAsset || feeAsset;
    }
    return { fee: totalFee, feeAsset };
  } catch {
    return { fee: 0, feeAsset: 'USDT' };
  }
}

// ==================== 启动策略 ====================
export async function startStrategy(strategy: Strategy, apiConfig: ApiConfig, symbolInfo?: SymbolInfo): Promise<void> {
  if (!strategy.id) throw new Error('策略缺少 ID');
  if (_executors.get(strategy.id)?.running) {
    log(strategy.id, '策略已在运行中');
    return;
  }

  const exchange = apiConfig.exchange || 'binance';
  setCurrentExchange(exchange);
  log(strategy.id, `启动策略: ${strategy.name} (${strategy.symbol})`);

  // 1. 获取当前价格
  let currentPrice: number;
  try {
    currentPrice = await getPrice(strategy.symbol);
    log(strategy.id, `当前价格: $${currentPrice}`);
  } catch (err: any) {
    log(strategy.id, `获取价格失败: ${err.message}`);
    throw err;
  }

  // 1.5 按当前价格开仓: 用实时价格更新 centerPrice 并重算各层上下界
  if (strategy.useCurrentPrice && currentPrice > 0) {
    const oldCenter = strategy.centerPrice;
    strategy.centerPrice = currentPrice;
    log(strategy.id, `[按当前价格开仓] centerPrice: $${oldCenter} → $${currentPrice}`);

    // 按比例缩放各层上下界
    if (oldCenter > 0) {
      const ratio = currentPrice / oldCenter;
      for (const layer of strategy.layers) {
        if (!layer.enabled) continue;
        layer.upperPrice = +(layer.upperPrice * ratio).toPrecision(8);
        layer.lowerPrice = +(layer.lowerPrice * ratio).toPrecision(8);
      }
      // 同步策略级的上下界
      if (strategy.rangeMode === 'fixed') {
        strategy.upperPrice = +(strategy.upperPrice * ratio).toPrecision(8);
        strategy.lowerPrice = +(strategy.lowerPrice * ratio).toPrecision(8);
      }
    }

    // 持久化到 DB
    await db.strategies.update(strategy.id, {
      centerPrice: strategy.centerPrice,
      upperPrice: strategy.upperPrice,
      lowerPrice: strategy.lowerPrice,
      layers: strategy.layers,
    });
  }

  // 2. 获取趋势
  let trend: 'bull' | 'bear' | 'neutral' = 'neutral';
  try {
    const klines = await getKlines(strategy.symbol, '1h', 30);
    const closes = klines.map(k => k.close);
    trend = detectTrend(closes, strategy.risk.trendDefenseEmaFast, strategy.risk.trendDefenseEmaSlow);
    log(strategy.id, `市场趋势: ${trend}`);
  } catch {
    log(strategy.id, '趋势检测失败，使用 neutral');
  }

  // 3. 清理旧的 pending 订单
  const existingOrders = await db.gridOrders.where('strategyId').equals(strategy.id).toArray();
  const pendingOrders = existingOrders.filter(o => o.status === 'placed' && o.binanceOrderId);
  if (pendingOrders.length > 0) {
    log(strategy.id, `取消 ${pendingOrders.length} 个旧挂单...`);
    for (const order of pendingOrders) {
      try {
        await cancelOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, order.binanceOrderId!);
      } catch {
        // 忽略取消失败（可能已成交或已取消）
      }
    }
  }
  // 只删除非 filled 的订单，保留已成交的历史记录
  const nonFilledOrders = existingOrders.filter(o => o.status !== 'filled');
  if (nonFilledOrders.length > 0) {
    await db.gridOrders.bulkDelete(nonFilledOrders.map(o => o.id!));
  }

  // 4. 为每个启用的层生成网格订单
  const allOrders: Omit<GridOrder, 'id'>[] = [];
  for (const layer of strategy.layers) {
    if (!layer.enabled) continue;
    const orders = generateGridOrders(strategy, currentPrice, layer, trend);
    allOrders.push(...orders);
    log(strategy.id, `${layer.layer}层: 生成 ${orders.length} 个网格订单`);
  }

  if (allOrders.length === 0) {
    log(strategy.id, '没有生成任何订单，请检查层配置');
    throw new Error('没有生成任何网格订单');
  }

  // 5. 保存到本地 DB
  const orderIds = await db.gridOrders.bulkAdd(allOrders as GridOrder[], { allKeys: true });
  const savedOrders: GridOrder[] = allOrders.map((o, i) => ({ ...o, id: orderIds[i] as number })) as GridOrder[];

  // 6. 向交易所下单
  const tickSize = symbolInfo?.tickSize || '0.01';
  const stepSize = symbolInfo?.stepSize || '0.00001';
  const pricePrecision = tickSize.indexOf('1') - tickSize.indexOf('.');
  const minNotional = symbolInfo?.minNotional || 1;

  let placedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const order of savedOrders) {
    const qty = parseFloat(formatQuantity(order.quantity, stepSize));
    const price = parseFloat(formatPrice(order.price, pricePrecision));
    const notional = qty * price;

    // 跳过小于最小名义价值的订单
    if (notional < minNotional) {
      await db.gridOrders.update(order.id!, { status: 'cancelled', updatedAt: Date.now() });
      skippedCount++;
      continue;
    }

    try {
      const result = await placeOrder({
        apiKey: apiConfig.apiKey,
        apiSecretEncrypted: apiConfig.apiSecret,
        symbol: strategy.symbol,
        side: order.side === 'buy' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        quantity: formatQuantity(order.quantity, stepSize),
        price: formatPrice(order.price, pricePrecision),
        timeInForce: 'GTC',
      });

      await db.gridOrders.update(order.id!, {
        status: 'placed',
        binanceOrderId: String(result.orderId),
        updatedAt: Date.now(),
      });
      placedCount++;
    } catch (err: any) {
      log(strategy.id, `下单失败 [${order.side} ${order.price}]: ${err.message}`);
      await db.gridOrders.update(order.id!, { status: 'error', updatedAt: Date.now() });
      errorCount++;
    }

    // 避免触发交易所限频
    await sleep(200);
  }

  log(strategy.id, `下单完成: 成功 ${placedCount}, 跳过 ${skippedCount}, 失败 ${errorCount}`);

  // 7. 更新策略状态
  const updateFields = {
    status: 'running' as const,
    startedAt: Date.now(),
    usedFund: placedCount > 0 ? strategy.totalFund : 0,
  };
  await db.strategies.update(strategy.id, updateFields);
  const updatedStrategy = await db.strategies.get(strategy.id);
  if (updatedStrategy) _onStrategyUpdate?.(updatedStrategy);

  // 8. 启动订单监控循环
  startMonitorLoop(strategy.id, apiConfig, symbolInfo);
}

// ==================== 策略广场同步 + 心跳 ====================
async function maybeSyncToPlaza(strategyId: number) {
  const now = Date.now();

  // 检查本地是否有分享记录
  let shareCodes: Record<string, string> = {};
  try {
    const saved = localStorage.getItem('aags_share_codes');
    if (saved) shareCodes = JSON.parse(saved);
  } catch { return; }

  const shareCode = shareCodes[strategyId];
  if (!shareCode) return;

  // --- 心跳: 每 2 分钟发送一次 (独立于数据同步) ---
  const lastHb = _lastHeartbeat.get(strategyId) || 0;
  if (now - lastHb >= HEARTBEAT_INTERVAL) {
    sendHeartbeat(shareCode); // fire-and-forget, 不 await
    _lastHeartbeat.set(strategyId, now);
  }

  // --- 数据同步: 每 5 分钟同步一次 ---
  const lastSync = _lastPlazaSync.get(strategyId) || 0;
  if (now - lastSync < PLAZA_SYNC_INTERVAL) return;

  const strategy = await db.strategies.get(strategyId);
  if (!strategy) return;

  const totalGridCount = (strategy.layers || []).filter(l => l.enabled).reduce((a, l) => a + (l.gridCount || 0), 0);
  const pnlPct = strategy.totalFund > 0 ? (strategy.totalProfit / strategy.totalFund * 100) : 0;
  const runSec = strategy.startedAt ? Math.floor((now - strategy.startedAt) / 1000) : 0;

  try {
    await syncStrategyData(shareCode, {
      pnlUsdt: strategy.totalProfit,
      pnlPercent: pnlPct,
      runSeconds: runSec,
      matchCount: strategy.winTrades,
      totalGrids: totalGridCount,
      maxDrawdownPct: strategy.maxDrawdown,
      isRunning: strategy.status === 'running',
    });
    _lastPlazaSync.set(strategyId, now);
    _lastHeartbeat.set(strategyId, now); // sync 也算一次心跳
    log(strategyId, `[策略广场] 收益数据已同步`);
  } catch (err: any) {
    // 同步失败不影响策略运行，静默处理
    console.warn(`[策略广场] 同步失败 (策略${strategyId}):`, err.message);
  }
}

// ==================== 订单监控循环 ====================
export function startMonitorLoop(strategyId: number, apiConfig: ApiConfig, symbolInfo?: SymbolInfo) {
  if (_executors.get(strategyId)?.running) return;

  const state: ExecutorState = { running: true, intervalId: null };
  _executors.set(strategyId, state);

  // 立即执行一次: 修复丢失记录 + 检查成交 + 重算利润
  (async () => {
    try {
      // 修复: 检查 filled 的 gridOrders 是否缺少 tradeRecord，补全丢失的记录
      await repairMissingTradeRecords(strategyId, apiConfig, symbolInfo);
      await checkAndProcessOrders(strategyId, apiConfig, symbolInfo);
      await updateStrategyProfit(strategyId);
    } catch (err: any) {
      log(strategyId, `首次检查异常: ${err.message}`);
    }
  })();

  // 每 10 秒检查一次订单状态
  state.intervalId = setInterval(async () => {
    try {
      await checkAndProcessOrders(strategyId, apiConfig, symbolInfo);
    } catch (err: any) {
      log(strategyId, `监控异常: ${err.message}`);
    }
    // 策略广场同步 (每 5 分钟)
    await maybeSyncToPlaza(strategyId);
  }, 10000);

  log(strategyId, '订单监控已启动 (10s 轮询)');
}

// ==================== 从币安同步丢失的成交记录 ====================
export async function repairMissingTradeRecords(strategyId: number, apiConfig: ApiConfig, symbolInfo?: SymbolInfo) {
  const strategy = await db.strategies.get(strategyId);
  if (!strategy) return;

  // 从未启动的策略不需要修复，避免拉取交易所数据污染到未启动的策略
  if (strategy.status === 'idle' || !strategy.startedAt) {
    return;
  }

  // 确保交易所已设置
  setCurrentExchange(apiConfig.exchange || 'binance');

  // 自行获取 symbolInfo（如果未传入）
  let si = symbolInfo;
  if (!si) {
    try {
      const allSymbols = await getExchangeInfo();
      si = allSymbols.find(s => s.symbol === strategy.symbol);
    } catch (err: any) {
      log(strategyId, `获取交易对信息失败: ${err.message}`);
    }
  }

  const tickSize = si?.tickSize || '0.00001';
  const stepSize = si?.stepSize || '0.00001';
  const pricePrecision = tickSize.indexOf('1') - tickSize.indexOf('.');
  const minNotional = si?.minNotional || 1;

  log(strategyId, `开始同步币安订单状态 (${strategy.symbol}), pricePrecision=${pricePrecision}, minNotional=${minNotional}`);

  // ===== Step 1: 逐个检查本地 placed 订单的真实状态 =====
  const placedOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'placed' && !!o.binanceOrderId)
    .toArray();

  // 获取已有 tradeRecords 用于去重
  const existingTrades = await db.tradeRecords.where('strategyId').equals(strategyId).toArray();
  const existingTradeIds = new Set(existingTrades.map(t => t.binanceTradeId));

  let syncedCount = 0;
  let cancelledCount = 0;

  console.log(`[同步] 检查 ${placedOrders.length} 个本地 placed 订单`);

  for (const order of placedOrders) {
    let result: any;
    try {
      result = await queryOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, order.binanceOrderId!);
    } catch (err: any) {
      console.log(`[同步] 查询失败 #${order.binanceOrderId}: ${err.message}`);
      await sleep(100);
      continue;
    }

    const status = result.status; // NEW, PARTIALLY_FILLED, FILLED, CANCELED, EXPIRED, REJECTED

    if (status === 'FILLED') {
      // 订单已成交 — 更新本地状态 + 补 tradeRecord
      const executedQty = parseFloat(result.executedQty || '0');
      const cummQuoteQty = parseFloat(result.cummulativeQuoteQty || '0');
      const actualPrice = executedQty > 0 ? (cummQuoteQty / executedQty) : order.price;
      const filledQty = executedQty > 0 ? executedQty : order.quantity;
      const orderTime = result.updateTime || result.time || Date.now();

      await db.gridOrders.update(order.id!, {
        status: 'filled',
        filledQuantity: filledQty,
        updatedAt: orderTime,
      });

      // 只有没有对应 tradeRecord 时才补创建
      if (!existingTradeIds.has(order.binanceOrderId!)) {
        const feeInfo = await fetchOrderFee(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, order.binanceOrderId!);
        await db.tradeRecords.add({
          strategyId,
          layer: order.layer,
          gridIndex: order.gridIndex,
          side: order.side,
          price: actualPrice,
          quantity: filledQty,
          quoteAmount: actualPrice * filledQty,
          profit: 0,
          fee: feeInfo.fee,
          feeAsset: feeInfo.feeAsset,
          binanceTradeId: order.binanceOrderId!,
          timestamp: orderTime,
        });
        existingTradeIds.add(order.binanceOrderId!);
      }

      // 检查是否已有反向单 → 没有就直接挂到币安
      if (order.targetPrice && order.targetPrice > 0) {
        const reverseSide = order.side === 'buy' ? 'sell' : 'buy';
        const existingReverse = await db.gridOrders
          .where('strategyId').equals(strategyId)
          .filter(o =>
            o.layer === order.layer &&
            o.gridIndex === order.gridIndex &&
            o.side === reverseSide &&
            (o.status === 'placed' || o.status === 'pending')
          )
          .count();

        if (existingReverse === 0) {
          const reversePrice = order.targetPrice;
          const qty = parseFloat(formatQuantity(filledQty, stepSize));
          const notional = qty * reversePrice;

          if (notional >= minNotional) {
            try {
              const placeResult = await placeOrder({
                apiKey: apiConfig.apiKey,
                apiSecretEncrypted: apiConfig.apiSecret,
                symbol: strategy.symbol,
                side: reverseSide === 'buy' ? 'BUY' : 'SELL',
                type: 'LIMIT',
                quantity: formatQuantity(filledQty, stepSize),
                price: formatPrice(reversePrice, pricePrecision),
                timeInForce: 'GTC',
              });

              await db.gridOrders.add({
                strategyId,
                layer: order.layer,
                gridIndex: order.gridIndex,
                side: reverseSide,
                price: reversePrice,
                quantity: filledQty,
                filledQuantity: 0,
                status: 'placed',
                targetPrice: actualPrice,
                profitRate: order.profitRate,
                binanceOrderId: String(placeResult.orderId),
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
              log(strategyId, `挂出反向单: ${reverseSide} ${order.layer}#${order.gridIndex} @ $${reversePrice.toFixed(pricePrecision)}`);
            } catch (err: any) {
              log(strategyId, `反向挂单失败: ${err.message}`);
            }
            await sleep(200);
          }
        }
      }

      syncedCount++;
      log(strategyId, `同步成交: ${order.side} ${order.layer}#${order.gridIndex} @ $${actualPrice.toFixed(5)} qty=${filledQty}`);

    } else if (status === 'CANCELED' || status === 'EXPIRED' || status === 'REJECTED') {
      // 订单已取消/过期 — 更新本地状态
      await db.gridOrders.update(order.id!, { status: 'cancelled', updatedAt: Date.now() });
      cancelledCount++;

    }
    // status === 'NEW' 或 'PARTIALLY_FILLED' 的保持 placed 不变

    await sleep(100); // 避免 API 限频
  }

  // ===== Step 2: 从币安 allOrders 补全已被本地删除的 gridOrders 对应的成交 =====
  try {
    const allBinanceOrders = await getAllOrders(
      apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, strategy.startedAt || undefined
    );

    const filledBinanceOrders = allBinanceOrders.filter((o: any) => o.status === 'FILLED');

    for (const binOrder of filledBinanceOrders) {
      const orderId = String(binOrder.orderId);
      if (existingTradeIds.has(orderId)) continue;

      const executedQty = parseFloat(binOrder.executedQty || '0');
      const cummQuoteQty = parseFloat(binOrder.cummulativeQuoteQty || '0');
      const actualPrice = executedQty > 0 ? (cummQuoteQty / executedQty) : 0;
      if (executedQty <= 0 || actualPrice <= 0) continue;

      const side = binOrder.side === 'BUY' ? 'buy' : 'sell';
      const orderTime = binOrder.updateTime || binOrder.time || Date.now();

      // 查找本地 gridOrder 获取网格层信息
      const localGridOrders = await db.gridOrders
        .where('strategyId').equals(strategyId)
        .filter(o => o.binanceOrderId === orderId)
        .toArray();
      const gridOrder = localGridOrders[0];
      const layer = gridOrder?.layer || 'inner';
      const gridIndex = gridOrder?.gridIndex || 0;

      const feeInfo2 = await fetchOrderFee(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, orderId);
      await db.tradeRecords.add({
        strategyId,
        layer: layer as any,
        gridIndex,
        side: side as any,
        price: actualPrice,
        quantity: executedQty,
        quoteAmount: actualPrice * executedQty,
        profit: 0,
        fee: feeInfo2.fee,
        feeAsset: feeInfo2.feeAsset,
        binanceTradeId: orderId,
        timestamp: orderTime,
      });

      // 补 filled gridOrder（如果不存在）
      if (!gridOrder) {
        await db.gridOrders.add({
          strategyId,
          layer: layer as any,
          gridIndex,
          side: side as any,
          price: actualPrice,
          quantity: executedQty,
          filledQuantity: executedQty,
          status: 'filled',
          binanceOrderId: orderId,
          createdAt: orderTime,
          updatedAt: orderTime,
        });
      }

      syncedCount++;
      existingTradeIds.add(orderId);
      log(strategyId, `补全历史成交: ${side} @ $${actualPrice.toFixed(5)} qty=${executedQty}`);
    }
  } catch (err: any) {
    log(strategyId, `拉取币安历史订单失败: ${err.message}`);
  }

  // ===== Step 3: 确保每个网格都有一个活跃挂单 =====
  // 原则：每个 layer+gridIndex 在任意时刻必须有且仅有1个 placed 订单在币安上。
  // 如果某个网格只有 filled 记录没有 placed → 说明反向单丢失，需要补挂。
  let reversePlaced = 0;

  // 3a. 先把所有遗留的 pending（未挂出）的订单挂到币安
  const pendingOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'pending' && !o.binanceOrderId)
    .toArray();

  console.log(`[Step3a] 找到 ${pendingOrders.length} 个 pending 订单, symbolInfo=${!!symbolInfo}, tickSize=${tickSize}, stepSize=${stepSize}, pricePrecision=${pricePrecision}, minNotional=${minNotional}`);
  log(strategyId, `Step3: ${pendingOrders.length}个pending, minNotional=${minNotional}`);

  for (const pending of pendingOrders) {
    const qty = parseFloat(formatQuantity(pending.quantity, stepSize));
    const notional = qty * pending.price;
    if (notional < minNotional) continue;

    const fmtQty = formatQuantity(pending.quantity, stepSize);
    const fmtPrice = formatPrice(pending.price, pricePrecision);
    console.log(`[Step3a] 挂出: ${pending.side} ${pending.layer}#${pending.gridIndex} price=${pending.price} -> fmtPrice=${fmtPrice}, qty=${pending.quantity} -> fmtQty=${fmtQty}, notional=${notional}`);

    try {
      const placeResult = await placeOrder({
        apiKey: apiConfig.apiKey,
        apiSecretEncrypted: apiConfig.apiSecret,
        symbol: strategy.symbol,
        side: pending.side === 'buy' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        quantity: fmtQty,
        price: fmtPrice,
        timeInForce: 'GTC',
      });

      await db.gridOrders.update(pending.id!, {
        status: 'placed',
        binanceOrderId: String(placeResult.orderId),
        updatedAt: Date.now(),
      });
      reversePlaced++;
      console.log(`[Step3a] 成功! orderId=${placeResult.orderId}`);
      log(strategyId, `挂出待挂单: ${pending.side} ${pending.layer}#${pending.gridIndex} @ $${fmtPrice}`);
    } catch (err: any) {
      console.error(`[Step3a] 挂单失败:`, err);
      log(strategyId, `挂出待挂单失败: ${err.message}，删除该记录`);
      await db.gridOrders.delete(pending.id!);
    }
    await sleep(200);
  }

  // 3b. 按 layer+gridIndex 分组，检查每个网格是否有活跃的 placed 挂单
  const allOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .toArray();

  // 按 layer+gridIndex 分组
  const gridGroups = new Map<string, typeof allOrders>();
  for (const o of allOrders) {
    const key = `${o.layer}_${o.gridIndex}`;
    const list = gridGroups.get(key) || [];
    list.push(o);
    gridGroups.set(key, list);
  }

  let noActiveCount = 0;
  for (const [key, group] of gridGroups) {
    // 清理重复: 同一网格如果有多个 placed，只保留最新的，取消其余
    const placedInGroup = group.filter(o => o.status === 'placed').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (placedInGroup.length > 1) {
      log(strategyId, `[Step3b去重] ${key}: ${placedInGroup.length}个placed，取消${placedInGroup.length - 1}个`);
      for (let i = 1; i < placedInGroup.length; i++) {
        const dup = placedInGroup[i];
        try {
          if (dup.binanceOrderId) {
            await cancelOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, dup.binanceOrderId);
          }
        } catch { /* 可能已取消 */ }
        await db.gridOrders.update(dup.id!, { status: 'cancelled', updatedAt: Date.now() });
        await sleep(100);
      }
    }

    // 该网格是否已有活跃挂单
    if (placedInGroup.length >= 1 || group.some(o => o.status === 'pending')) continue;

    noActiveCount++;

    // 没有活跃挂单 → 找最近一次成交，挂反向单
    const filledOrders = group
      .filter(o => o.status === 'filled' && !!o.targetPrice && o.targetPrice > 0)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (filledOrders.length === 0) {
      console.log(`[Step3b] ${key}: 无活跃挂单，也无可用 filled 订单 (共${group.length}条, 状态: ${group.map(o => o.status).join(',')})`);
      continue;
    }

    const lastFilled = filledOrders[0]; // 最近一次成交
    console.log(`[Step3b] ${key}: 无活跃挂单，最近成交=${lastFilled.side}@${lastFilled.price}, targetPrice=${lastFilled.targetPrice}, qty=${lastFilled.filledQuantity || lastFilled.quantity}`);
    const reverseSide = lastFilled.side === 'buy' ? 'sell' : 'buy';
    const reversePrice = lastFilled.targetPrice!;
    const filledQty = lastFilled.filledQuantity || lastFilled.quantity;
    const qty = parseFloat(formatQuantity(filledQty, stepSize));
    const notional = qty * reversePrice;

    if (notional < minNotional) continue;

    const fmtQtyB = formatQuantity(filledQty, stepSize);
    const fmtPriceB = formatPrice(reversePrice, pricePrecision);
    console.log(`[Step3b] 挂出: ${reverseSide} [${key}] price=${reversePrice} -> fmtPrice=${fmtPriceB}, qty=${filledQty} -> fmtQty=${fmtQtyB}, notional=${notional}`);

    try {
      const placeResult = await placeOrder({
        apiKey: apiConfig.apiKey,
        apiSecretEncrypted: apiConfig.apiSecret,
        symbol: strategy.symbol,
        side: reverseSide === 'buy' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        quantity: fmtQtyB,
        price: fmtPriceB,
        timeInForce: 'GTC',
      });

      await db.gridOrders.add({
        strategyId,
        layer: lastFilled.layer,
        gridIndex: lastFilled.gridIndex,
        side: reverseSide,
        price: reversePrice,
        quantity: filledQty,
        filledQuantity: 0,
        status: 'placed',
        targetPrice: lastFilled.price, // 成交后挂回原方向价格
        profitRate: lastFilled.profitRate,
        binanceOrderId: String(placeResult.orderId),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      reversePlaced++;
      console.log(`[Step3b] 成功! orderId=${placeResult.orderId}`);
      log(strategyId, `补挂反向单: ${reverseSide} [${key}] @ $${fmtPriceB}`);
    } catch (err: any) {
      console.error(`[Step3b] 补挂失败 [${key}]:`, err);
      log(strategyId, `补挂反向单失败 [${key}]: ${err.message}`);
    }
    await sleep(200);
  }

  // ===== Step 3c: 根据策略配置重新生成完整网格，补齐完全缺失的网格 =====
  // 上面 Step 3b 只能处理本地 DB 有记录的网格。如果某些网格的记录被删除了或从未下过单，
  // 需要根据策略 layers 配置重新生成，对比已有 placed 订单，缺失的重新下单。
  let regenerated = 0;

  // 重新获取当前已 placed 的网格集合
  const currentPlaced = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'placed' || o.status === 'pending')
    .toArray();
  const placedKeys = new Set(currentPlaced.map(o => `${o.layer}_${o.gridIndex}`));

  // 获取当前价格和趋势
  let currentPrice: number;
  try {
    currentPrice = await getPrice(strategy.symbol);
  } catch (err: any) {
    log(strategyId, `[Step3c] 获取价格失败，跳过补齐: ${err.message}`);
    currentPrice = 0;
  }

  if (currentPrice > 0) {
    let trend: 'bull' | 'bear' | 'neutral' = 'neutral';
    try {
      const klines = await getKlines(strategy.symbol, '1h', 30);
      const closes = klines.map(k => k.close);
      trend = detectTrend(closes, strategy.risk.trendDefenseEmaFast, strategy.risk.trendDefenseEmaSlow);
    } catch { /* 使用 neutral */ }

    // 计算应该存在的所有网格总数
    let expectedTotal = 0;
    for (const layer of strategy.layers) {
      if (!layer.enabled) continue;
      expectedTotal += layer.gridCount;
    }

    log(strategyId, `[Step3c] 已有挂单: ${placedKeys.size}, 策略应有: ${expectedTotal}`);

    if (placedKeys.size < expectedTotal) {
      // 为每个 enabled 层生成网格订单，只补缺失的
      for (const layer of strategy.layers) {
        if (!layer.enabled) continue;
        const expectedOrders = generateGridOrders(strategy, currentPrice, layer, trend);

        for (const order of expectedOrders) {
          const key = `${order.layer}_${order.gridIndex}`;
          if (placedKeys.has(key)) continue; // 已有挂单，跳过

          const qty = parseFloat(formatQuantity(order.quantity, stepSize));
          const price = parseFloat(formatPrice(order.price, pricePrecision));
          const notional = qty * price;
          if (notional < minNotional) continue;

          try {
            const result = await placeOrder({
              apiKey: apiConfig.apiKey,
              apiSecretEncrypted: apiConfig.apiSecret,
              symbol: strategy.symbol,
              side: order.side === 'buy' ? 'BUY' : 'SELL',
              type: 'LIMIT',
              quantity: formatQuantity(order.quantity, stepSize),
              price: formatPrice(order.price, pricePrecision),
              timeInForce: 'GTC',
            });

            await db.gridOrders.add({
              strategyId,
              layer: order.layer,
              gridIndex: order.gridIndex,
              side: order.side,
              price: order.price,
              quantity: order.quantity,
              filledQuantity: 0,
              status: 'placed',
              targetPrice: order.targetPrice,
              profitRate: order.profitRate,
              binanceOrderId: String(result.orderId),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            placedKeys.add(key);
            regenerated++;
            log(strategyId, `[Step3c] 补挂: ${order.side} ${key} @ $${formatPrice(order.price, pricePrecision)}`);
          } catch (err: any) {
            log(strategyId, `[Step3c] 补挂失败 ${key}: ${err.message}`);
          }
          await sleep(200);
        }
      }
    }
  }

  // ===== Step 4: 补全已有 tradeRecords 中缺失的手续费 =====
  let feeFixed = 0;
  const allTrades = await db.tradeRecords.where('strategyId').equals(strategyId).toArray();
  for (const tr of allTrades) {
    if (tr.fee === 0 && tr.binanceTradeId) {
      const feeInfo = await fetchOrderFee(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, tr.binanceTradeId);
      if (feeInfo.fee > 0) {
        await db.tradeRecords.update(tr.id!, { fee: feeInfo.fee, feeAsset: feeInfo.feeAsset });
        feeFixed++;
      }
      await sleep(100);
    }
  }

  const totalActions = syncedCount + cancelledCount + reversePlaced + regenerated + feeFixed;
  if (totalActions > 0) {
    log(strategyId, `同步完成: ${syncedCount}笔成交补全, ${cancelledCount}笔已取消, ${reversePlaced}个反向单已挂出, ${regenerated}个网格已补齐, ${feeFixed}笔手续费补全`);
  } else {
    log(strategyId, `订单状态完全同步`);
  }
}

// ==================== 检查订单成交并挂反向单 ====================
async function checkAndProcessOrders(strategyId: number, apiConfig: ApiConfig, symbolInfo?: SymbolInfo) {
  // 防并发锁: 如果上一次还没执行完，跳过本次
  if (_checkLocks.get(strategyId)) return;
  _checkLocks.set(strategyId, true);

  try {
    await _doCheckAndProcess(strategyId, apiConfig, symbolInfo);
  } finally {
    _checkLocks.set(strategyId, false);
  }
}

async function _doCheckAndProcess(strategyId: number, apiConfig: ApiConfig, symbolInfo?: SymbolInfo) {
  const strategy = await db.strategies.get(strategyId);
  if (!strategy || strategy.status !== 'running') {
    stopMonitorLoop(strategyId);
    return;
  }

  // 自行获取 symbolInfo（如果未传入）
  let si = symbolInfo;
  if (!si) {
    try {
      const allSymbols = await getExchangeInfo();
      si = allSymbols.find(s => s.symbol === strategy.symbol);
    } catch { /* 使用默认值 */ }
  }

  const tickSize = si?.tickSize || '0.00001';
  const stepSize = si?.stepSize || '0.00001';
  const pricePrecision = tickSize.indexOf('1') - tickSize.indexOf('.');
  const minNotional = si?.minNotional || 1;

  // ===== 阶段A: 将 pending 订单挂到币安 =====
  const pendingOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'pending' && !o.binanceOrderId)
    .toArray();

  for (const order of pendingOrders) {
    const qty = parseFloat(formatQuantity(order.quantity, stepSize));
    const notional = qty * order.price;
    if (notional < minNotional) continue;

    try {
      const result = await placeOrder({
        apiKey: apiConfig.apiKey,
        apiSecretEncrypted: apiConfig.apiSecret,
        symbol: strategy.symbol,
        side: order.side === 'buy' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        quantity: formatQuantity(order.quantity, stepSize),
        price: formatPrice(order.price, pricePrecision),
        timeInForce: 'GTC',
      });

      await db.gridOrders.update(order.id!, {
        status: 'placed',
        binanceOrderId: String(result.orderId),
        updatedAt: Date.now(),
      });

      log(strategyId, `挂出待挂单: ${order.side} ${order.layer}#${order.gridIndex} @ $${order.price.toFixed(pricePrecision)}`);
    } catch (err: any) {
      log(strategyId, `待挂单失败: ${order.side} ${order.layer}#${order.gridIndex}: ${err.message}`);
    }

    await sleep(200);
  }

  // ===== 阶段B: 检查 placed 订单的成交状态 =====
  const localOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'placed' && !!o.binanceOrderId)
    .toArray();

  let filledCount = 0;

  if (localOrders.length === 0) {
    // 没有 placed 订单也要继续执行阶段C（去重+补挂）和利润重算
  } else {

  for (const order of localOrders) {
    // 通过 queryOrder 直接查询币安上的订单真实状态
    let orderStatus: string;
    let executedQty: number;
    let actualPrice: number;
    try {
      const result = await queryOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, order.binanceOrderId!);
      orderStatus = result.status; // NEW, PARTIALLY_FILLED, FILLED, CANCELED, EXPIRED, etc.
      executedQty = parseFloat(result.executedQty || '0');
      // cummulativeQuoteQty / executedQty = 实际成交均价
      const cummQuoteQty = parseFloat(result.cummulativeQuoteQty || '0');
      actualPrice = executedQty > 0 ? (cummQuoteQty / executedQty) : order.price;
    } catch (err: any) {
      log(strategyId, `查询订单状态失败 #${order.binanceOrderId}: ${err.message}`);
      await sleep(100);
      continue;
    }

    // 只处理已完全成交的订单
    if (orderStatus !== 'FILLED') {
      // 如果被取消或过期，更新本地状态
      if (orderStatus === 'CANCELED' || orderStatus === 'EXPIRED' || orderStatus === 'REJECTED') {
        await db.gridOrders.update(order.id!, { status: 'cancelled', updatedAt: Date.now() });
        log(strategyId, `订单已${orderStatus}: ${order.side} ${order.layer}#${order.gridIndex} @ $${order.price}`);
      }
      await sleep(100);
      continue;
    }

    // === 订单已成交 ===
    const filledQty = executedQty > 0 ? executedQty : order.quantity;
    log(strategyId, `订单成交: ${order.side} ${order.layer}#${order.gridIndex} @ $${actualPrice.toFixed(pricePrecision)} (qty=${filledQty})`);

    // 更新为已成交
    await db.gridOrders.update(order.id!, {
      status: 'filled',
      filledQuantity: filledQty,
      updatedAt: Date.now(),
    });

    // 记录交易 (去重: 避免同一个 binanceOrderId 被记录多次)
    const existingTrade = await db.tradeRecords
      .where('strategyId').equals(strategyId)
      .filter(t => t.binanceTradeId === order.binanceOrderId)
      .first();
    if (!existingTrade) {
      const feeInfo3 = await fetchOrderFee(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, order.binanceOrderId!);
      await db.tradeRecords.add({
        strategyId,
        layer: order.layer,
        gridIndex: order.gridIndex,
        side: order.side,
        price: actualPrice,
        quantity: filledQty,
        quoteAmount: actualPrice * filledQty,
        profit: 0,
        fee: feeInfo3.fee,
        feeAsset: feeInfo3.feeAsset,
        binanceTradeId: order.binanceOrderId || '',
        timestamp: Date.now(),
      });
    } else {
      log(strategyId, `跳过重复记录: ${order.side} ${order.layer}#${order.gridIndex} binanceId=${order.binanceOrderId}`);
    }

    filledCount++;

    // 挂反向单
    if (order.targetPrice && order.targetPrice > 0) {
      const reverseSide = order.side === 'buy' ? 'sell' : 'buy';
      const reversePrice = order.targetPrice;
      const qty = parseFloat(formatQuantity(filledQty, stepSize));
      const notional = qty * reversePrice;

      if (notional >= minNotional) {
        try {
          const result = await placeOrder({
            apiKey: apiConfig.apiKey,
            apiSecretEncrypted: apiConfig.apiSecret,
            symbol: strategy.symbol,
            side: reverseSide === 'buy' ? 'BUY' : 'SELL',
            type: 'LIMIT',
            quantity: formatQuantity(filledQty, stepSize),
            price: formatPrice(reversePrice, pricePrecision),
            timeInForce: 'GTC',
          });

          // 创建反向订单记录
          await db.gridOrders.add({
            strategyId,
            layer: order.layer,
            gridIndex: order.gridIndex,
            side: reverseSide,
            price: reversePrice,
            quantity: filledQty,
            filledQuantity: 0,
            status: 'placed',
            targetPrice: actualPrice, // 成交后再挂回原方向 (用实际成交价)
            profitRate: order.profitRate,
            binanceOrderId: String(result.orderId),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          log(strategyId, `反向挂单: ${reverseSide} @ $${reversePrice.toFixed(pricePrecision)}`);
        } catch (err: any) {
          log(strategyId, `反向挂单失败: ${err.message}`);
        }

        await sleep(200);
      }
    }

    await sleep(100); // 避免 API 限频
  }

  } // end of localOrders.length > 0

  // 每次轮询都重算利润，确保配对数据和利润值始终最新
  await updateStrategyProfit(strategyId);

  // ===== 阶段C: 确保每个网格有且仅有1个活跃挂单 =====
  const allGridOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .toArray();

  const groups = new Map<string, typeof allGridOrders>();
  for (const o of allGridOrders) {
    const k = `${o.layer}_${o.gridIndex}`;
    const arr = groups.get(k) || [];
    arr.push(o);
    groups.set(k, arr);
  }

  for (const [gk, gOrders] of groups) {
    // 清理重复: 同一网格如果有多个 placed，只保留最新的，取消其余
    const placedOrders = gOrders.filter(o => o.status === 'placed').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (placedOrders.length > 1) {
      log(strategyId, `[去重] ${gk}: ${placedOrders.length}个placed，保留最新，取消${placedOrders.length - 1}个`);
      for (let i = 1; i < placedOrders.length; i++) {
        const dup = placedOrders[i];
        try {
          if (dup.binanceOrderId) {
            await cancelOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, dup.binanceOrderId);
          }
        } catch { /* 可能已取消 */ }
        await db.gridOrders.update(dup.id!, { status: 'cancelled', updatedAt: Date.now() });
        await sleep(100);
      }
    }

    // 已有活跃挂单? → 跳过（注意: 去重后 placedOrders[0] 是保留的那个）
    if (placedOrders.length >= 1 || gOrders.some(o => o.status === 'pending')) continue;

    // 找最近一次有 targetPrice 的成交
    const fills = gOrders
      .filter(o => o.status === 'filled' && !!o.targetPrice && o.targetPrice > 0)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (fills.length === 0) continue;

    const last = fills[0];
    const rSide = last.side === 'buy' ? 'sell' : 'buy';
    const rPrice = last.targetPrice!;
    const rQty = last.filledQuantity || last.quantity;
    const fmtQ = formatQuantity(rQty, stepSize);
    const fmtP = formatPrice(rPrice, pricePrecision);
    const notional = parseFloat(fmtQ) * rPrice;
    if (notional < minNotional) continue;

    try {
      const res = await placeOrder({
        apiKey: apiConfig.apiKey,
        apiSecretEncrypted: apiConfig.apiSecret,
        symbol: strategy.symbol,
        side: rSide === 'buy' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        quantity: fmtQ,
        price: fmtP,
        timeInForce: 'GTC',
      });

      await db.gridOrders.add({
        strategyId,
        layer: last.layer,
        gridIndex: last.gridIndex,
        side: rSide,
        price: rPrice,
        quantity: rQty,
        filledQuantity: 0,
        status: 'placed',
        targetPrice: last.price,
        profitRate: last.profitRate,
        binanceOrderId: String(res.orderId),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      log(strategyId, `补挂反向单: ${rSide} [${gk}] @ $${fmtP}`);
    } catch (err: any) {
      log(strategyId, `补挂失败 [${gk}]: ${err.message}`);
    }
    await sleep(200);
  }

  // ===== 阶段D: 定期网格完整性检查 — 补齐完全缺失的网格 =====
  // 每 GRID_INTEGRITY_INTERVAL 做一次，根据策略 layers 配置重新生成完整网格，
  // 对比已有 placed 订单，缺失的重新下单。
  const now = Date.now();
  const lastCheck = _lastGridIntegrityCheck.get(strategyId) || 0;
  if (now - lastCheck >= GRID_INTEGRITY_INTERVAL) {
    _lastGridIntegrityCheck.set(strategyId, now);

    const currentPlacedOrders = await db.gridOrders
      .where('strategyId').equals(strategyId)
      .filter(o => o.status === 'placed' || o.status === 'pending')
      .toArray();
    const placedKeys = new Set(currentPlacedOrders.map(o => `${o.layer}_${o.gridIndex}`));

    let expectedTotal = 0;
    for (const layer of strategy.layers) {
      if (!layer.enabled) continue;
      expectedTotal += layer.gridCount;
    }

    if (placedKeys.size < expectedTotal) {
      log(strategyId, `[网格检查] 挂单 ${placedKeys.size}/${expectedTotal}, 开始补齐...`);

      let curPrice: number;
      try {
        curPrice = await getPrice(strategy.symbol);
      } catch {
        curPrice = 0;
      }

      if (curPrice > 0) {
        let trend: 'bull' | 'bear' | 'neutral' = 'neutral';
        try {
          const klines = await getKlines(strategy.symbol, '1h', 30);
          const closes = klines.map(k => k.close);
          trend = detectTrend(closes, strategy.risk.trendDefenseEmaFast, strategy.risk.trendDefenseEmaSlow);
        } catch { /* neutral */ }

        let filled = 0;
        for (const layer of strategy.layers) {
          if (!layer.enabled) continue;
          const expectedOrders = generateGridOrders(strategy, curPrice, layer, trend);

          for (const order of expectedOrders) {
            const key = `${order.layer}_${order.gridIndex}`;
            if (placedKeys.has(key)) continue;

            const qty = parseFloat(formatQuantity(order.quantity, stepSize));
            const price = parseFloat(formatPrice(order.price, pricePrecision));
            const notional = qty * price;
            if (notional < minNotional) continue;

            try {
              const result = await placeOrder({
                apiKey: apiConfig.apiKey,
                apiSecretEncrypted: apiConfig.apiSecret,
                symbol: strategy.symbol,
                side: order.side === 'buy' ? 'BUY' : 'SELL',
                type: 'LIMIT',
                quantity: formatQuantity(order.quantity, stepSize),
                price: formatPrice(order.price, pricePrecision),
                timeInForce: 'GTC',
              });

              await db.gridOrders.add({
                strategyId,
                layer: order.layer,
                gridIndex: order.gridIndex,
                side: order.side,
                price: order.price,
                quantity: order.quantity,
                filledQuantity: 0,
                status: 'placed',
                targetPrice: order.targetPrice,
                profitRate: order.profitRate,
                binanceOrderId: String(result.orderId),
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
              placedKeys.add(key);
              filled++;
            } catch (err: any) {
              log(strategyId, `[网格检查] 补挂失败 ${key}: ${err.message}`);
            }
            await sleep(200);
          }
        }

        if (filled > 0) {
          log(strategyId, `[网格检查] 补齐完成: +${filled} 个挂单, 当前 ${placedKeys.size}/${expectedTotal}`);
        }
      }
    }
  }
}

// ==================== 更新策略利润 ====================
export async function updateStrategyProfit(strategyId: number, forceSnapshot = false) {
  const strategy = await db.strategies.get(strategyId);
  if (!strategy) return;

  // 从未启动的策略不需要计算利润
  if (strategy.status === 'idle' && !strategy.startedAt) {
    return;
  }

  const trades = await db.tradeRecords.where('strategyId').equals(strategyId).toArray();
  const filledOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'filled')
    .toArray();

  console.log(`[利润重算] 策略${strategyId}: tradeRecords=${trades.length}条, filledOrders=${filledOrders.length}条`);

  // 去重: 删除重复的 binanceTradeId 记录（保留最早的一条）
  const seenTradeIds = new Map<string, number>(); // binanceTradeId → 保留的记录ID
  const dupIds: number[] = [];
  for (const t of trades.sort((a, b) => a.timestamp - b.timestamp)) {
    if (t.binanceTradeId && seenTradeIds.has(t.binanceTradeId)) {
      dupIds.push(t.id!);
    } else if (t.binanceTradeId) {
      seenTradeIds.set(t.binanceTradeId, t.id!);
    }
  }
  if (dupIds.length > 0) {
    console.warn(`[利润重算] 发现 ${dupIds.length} 条重复 tradeRecord，正在删除...`);
    log(strategyId, `清理 ${dupIds.length} 条重复成交记录`);
    await db.tradeRecords.bulkDelete(dupIds);
    // 重新读取去重后的数据
    const cleanTrades = await db.tradeRecords.where('strategyId').equals(strategyId).toArray();
    trades.length = 0;
    trades.push(...cleanTrades);
  }

  // 利润计算: 按 layer+gridIndex 分组，时间排序后依次配对 buy→sell
  let totalProfit = 0;
  let todayProfit = 0;
  let pairedCount = 0;
  let winCount = 0;
  const todayStart = new Date().setHours(0, 0, 0, 0);

  // 按 layer+gridIndex 分组
  const groups = new Map<string, typeof trades>();
  for (const t of trades) {
    const key = `${t.layer}_${t.gridIndex}`;
    const list = groups.get(key) || [];
    list.push(t);
    groups.set(key, list);
  }

  const profitUpdates: { id: number; profit: number }[] = [];

  for (const [, group] of groups) {
    // 按时间排序
    group.sort((a, b) => a.timestamp - b.timestamp);

    // 依次配对: 遇到 buy 压栈，遇到 sell 弹出最近的 buy 配对
    const buyStack: typeof trades = [];
    for (const t of group) {
      if (t.side === 'buy') {
        buyStack.push(t);
      } else if (t.side === 'sell' && buyStack.length > 0) {
        const matchBuy = buyStack.shift()!; // FIFO: 最早的buy先配对
        const profit = (t.price - matchBuy.price) * t.quantity;
        totalProfit += profit;
        pairedCount++;
        if (profit > 0) winCount++;
        if (t.timestamp >= todayStart) todayProfit += profit;
        // 把利润写到卖单上（供 Reports 页面使用）
        if (t.id && t.profit !== profit) {
          profitUpdates.push({ id: t.id, profit });
        }
      }
    }
  }

  // 批量回写利润到 tradeRecords
  if (profitUpdates.length > 0) {
    for (const u of profitUpdates) {
      await db.tradeRecords.update(u.id, { profit: u.profit });
    }
  }

  // 只在利润变化时打日志
  if (Math.abs(totalProfit - strategy.totalProfit) > 0.000001 || pairedCount !== strategy.totalTrades) {
    console.log(`[利润重算] 策略${strategyId}: ${strategy.totalProfit} → ${totalProfit} (${pairedCount}对)`);
    log(strategyId, `利润更新: ${strategy.totalProfit.toFixed(5)} → ${totalProfit.toFixed(5)} (${pairedCount}对配对)`);
  }

  const updated: Partial<Strategy> = {
    totalProfit,
    todayProfit,
    totalTrades: pairedCount,
    winTrades: winCount,
  };

  await db.strategies.update(strategyId, updated);
  const full = await db.strategies.get(strategyId);
  if (full) _onStrategyUpdate?.(full);

  // ===== 净值快照: 每次利润重算后记录，限制每策略每5分钟最多1条 =====
  try {
    const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5分钟
    const latestSnap = await db.equitySnapshots
      .where('strategyId').equals(strategyId)
      .reverse().sortBy('timestamp')
      .then(arr => arr[0]);
    if (forceSnapshot || !latestSnap || Date.now() - latestSnap.timestamp >= SNAPSHOT_INTERVAL) {
      const strat = await db.strategies.get(strategyId);
      if (strat) {
        // 币持仓 = 所有当前挂着的卖单的币总数（挂卖单 = 持有的币等待卖出）
        const placedSells = await db.gridOrders
          .where('strategyId').equals(strategyId)
          .filter(o => o.status === 'placed' && o.side === 'sell')
          .toArray();
        const holdQty = placedSells.reduce((sum, o) => sum + (o.quantity || 0), 0);

        let latestPrice = 0;
        try { latestPrice = await getPrice(strat.symbol); } catch { /* ignore */ }

        const coinValue = holdQty * latestPrice; // 持有币的 USDT 市值
        const usdtValue = Math.max(0, strat.totalFund + totalProfit - coinValue); // 剩余 USDT
        const totalValue = coinValue + usdtValue;
        const unrealizedPnl = coinValue > 0 ? (coinValue - placedSells.reduce((sum, o) => sum + o.price * (o.quantity || 0), 0)) : 0;

        await db.equitySnapshots.add({
          strategyId,
          totalValue,
          coinValue,
          usdtValue,
          unrealizedPnl,
          timestamp: Date.now(),
        });
      }
    }
  } catch (e) {
    console.warn('[净值快照] 记录失败:', e);
  }
}

// ==================== 停止策略 ====================
export async function stopStrategy(strategyId: number, apiConfig: ApiConfig): Promise<void> {
  log(strategyId, '正在停止策略...');

  // 停止监控循环
  stopMonitorLoop(strategyId);

  // 取消所有挂单
  const strategy = await db.strategies.get(strategyId);
  if (!strategy) return;

  setCurrentExchange(apiConfig.exchange || 'binance');

  // === 第一步: 取消本地 DB 中记录的挂单 ===
  const placedOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'placed' && !!o.binanceOrderId)
    .toArray();

  let cancelledCount = 0;
  const cancelledIds = new Set<string>();
  for (const order of placedOrders) {
    try {
      await cancelOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, order.binanceOrderId!);
      cancelledIds.add(order.binanceOrderId!);
      cancelledCount++;
    } catch {
      // 忽略取消失败（可能已成交或已取消）
    }
    await db.gridOrders.update(order.id!, { status: 'cancelled', updatedAt: Date.now() });
    await sleep(200);
  }

  log(strategyId, `本地记录取消: ${cancelledCount} 个`);

  // === 第二步: 收集本策略所有历史 binanceOrderId，在交易所挂单中匹配并取消残留 ===
  try {
    // 从本地 DB 获取本策略所有曾经下过的订单 ID（不限状态）
    const allStrategyOrders = await db.gridOrders
      .where('strategyId').equals(strategyId)
      .filter(o => !!o.binanceOrderId)
      .toArray();
    const strategyOrderIds = new Set(allStrategyOrders.map(o => o.binanceOrderId!));

    // 查询交易所该币对当前所有挂单
    const exchangeOpenOrders = await getOpenOrders(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol);
    if (exchangeOpenOrders && exchangeOpenOrders.length > 0) {
      let extraCancelled = 0;
      for (const eo of exchangeOpenOrders) {
        const oid = String(eo.orderId || eo.order_id || eo.id || '');
        if (!oid || cancelledIds.has(oid)) continue; // 已经取消过的跳过
        // 只取消属于本策略的挂单
        if (!strategyOrderIds.has(oid)) continue;
        try {
          await cancelOrder(apiConfig.apiKey, apiConfig.apiSecret, strategy.symbol, oid);
          extraCancelled++;
        } catch {
          // 忽略
        }
        await sleep(200);
      }
      if (extraCancelled > 0) {
        log(strategyId, `交易所残留取消: ${extraCancelled} 个`);
        cancelledCount += extraCancelled;
      }
    }
  } catch (err: any) {
    log(strategyId, `查询交易所挂单失败: ${err.message}，仅取消了本地记录的挂单`);
  }

  log(strategyId, `共取消 ${cancelledCount} 个挂单`);

  // 更新策略状态
  await db.strategies.update(strategyId, { status: 'stopped', stoppedAt: Date.now() });
  const stopped = await db.strategies.get(strategyId);
  if (stopped) _onStrategyUpdate?.(stopped);

  // 最后一次同步到策略广场: 通知已停止
  try {
    let shareCodes: Record<string, string> = {};
    const saved = localStorage.getItem('aags_share_codes');
    if (saved) shareCodes = JSON.parse(saved);
    const shareCode = shareCodes[strategyId];
    if (shareCode && stopped) {
      const totalGridCount = (stopped.layers || []).filter(l => l.enabled).reduce((a, l) => a + (l.gridCount || 0), 0);
      const pnlPct = stopped.totalFund > 0 ? (stopped.totalProfit / stopped.totalFund * 100) : 0;
      const runSec = stopped.startedAt ? Math.floor((Date.now() - stopped.startedAt) / 1000) : 0;
      await syncStrategyData(shareCode, {
        pnlUsdt: stopped.totalProfit,
        pnlPercent: pnlPct,
        runSeconds: runSec,
        matchCount: stopped.winTrades,
        totalGrids: totalGridCount,
        maxDrawdownPct: stopped.maxDrawdown,
        isRunning: false,
      });
      log(strategyId, '[策略广场] 已同步停止状态');
    }
  } catch (err: any) {
    console.warn(`[策略广场] 停止同步失败:`, err.message);
  }
}

// ==================== 停止策略（不取消挂单） ====================
export async function stopStrategyWithoutCancel(strategyId: number): Promise<void> {
  log(strategyId, '直接终止策略（保留交易所挂单）...');
  stopMonitorLoop(strategyId);

  await db.strategies.update(strategyId, { status: 'stopped', stoppedAt: Date.now() });
  const stopped = await db.strategies.get(strategyId);
  if (stopped) _onStrategyUpdate?.(stopped);
}

// ==================== 暂停策略 ====================
export async function pauseStrategy(strategyId: number, _apiConfig: ApiConfig): Promise<void> {
  log(strategyId, '暂停策略，保留挂单...');
  stopMonitorLoop(strategyId);

  const strategy = await db.strategies.get(strategyId);
  if (!strategy) return;

  await db.strategies.update(strategyId, { status: 'paused' });
  const paused = await db.strategies.get(strategyId);
  if (paused) _onStrategyUpdate?.(paused);
}

// ==================== 恢复策略 ====================
export async function resumeStrategy(strategyId: number, apiConfig: ApiConfig, symbolInfo?: SymbolInfo): Promise<void> {
  const strategy = await db.strategies.get(strategyId);
  if (!strategy) return;

  setCurrentExchange(apiConfig.exchange || 'binance');

  // 检查是否有已下的挂单，如果没有则走完整启动流程
  const placedOrders = await db.gridOrders
    .where('strategyId').equals(strategyId)
    .filter(o => o.status === 'placed')
    .count();

  if (placedOrders === 0) {
    log(strategyId, '没有已挂订单，执行完整启动流程...');
    // 重置状态为 idle 再走 startStrategy
    await db.strategies.update(strategyId, { status: 'idle' });
    const reset = await db.strategies.get(strategyId);
    if (reset) await startStrategy(reset, apiConfig, symbolInfo);
    return;
  }

  log(strategyId, `恢复策略监控 (${placedOrders} 个挂单)...`);
  await db.strategies.update(strategyId, { status: 'running' });
  const resumed = await db.strategies.get(strategyId);
  if (resumed) _onStrategyUpdate?.(resumed);

  startMonitorLoop(strategyId, apiConfig, symbolInfo);
}

// ==================== 辅助函数 ====================
function stopMonitorLoop(strategyId: number) {
  const state = _executors.get(strategyId);
  if (state) {
    if (state.intervalId) clearInterval(state.intervalId);
    state.running = false;
    _executors.delete(strategyId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 全局同步所有策略挂单 ====================
export interface SyncResult {
  strategyId: number;
  strategyName: string;
  symbol: string;
  placedBefore: number;
  placedAfter: number;
  repaired: boolean;
  error?: string;
}

export async function syncAllStrategiesOrders(
  apiConfig: ApiConfig,
  symbols: SymbolInfo[],
  onProgress?: (msg: string) => void,
): Promise<SyncResult[]> {
  const strategies = await db.strategies.toArray();
  const runningStrategies = strategies.filter(s => s.status === 'running' || s.status === 'paused');

  if (runningStrategies.length === 0) {
    onProgress?.('没有运行中的策略');
    return [];
  }

  setCurrentExchange(apiConfig.exchange || 'binance');
  const results: SyncResult[] = [];

  for (const strategy of runningStrategies) {
    if (!strategy.id) continue;
    const si = symbols.find(s => s.symbol === strategy.symbol);

    // 同步前的挂单数
    const beforeOrders = await db.gridOrders
      .where('strategyId').equals(strategy.id)
      .filter(o => o.status === 'placed')
      .count();

    onProgress?.(`正在同步: ${strategy.name} (${strategy.symbol})...`);

    try {
      // 1. 修复丢失的成交记录 + 补挂反向单
      await repairMissingTradeRecords(strategy.id, apiConfig, si);

      // 2. 重算利润
      await updateStrategyProfit(strategy.id);

      // 3. 确保监控循环在运行
      if (strategy.status === 'running' && !_executors.get(strategy.id)?.running) {
        startMonitorLoop(strategy.id, apiConfig, si);
      }

      // 同步后的挂单数
      const afterOrders = await db.gridOrders
        .where('strategyId').equals(strategy.id)
        .filter(o => o.status === 'placed')
        .count();

      const fresh = await db.strategies.get(strategy.id);
      if (fresh) _onStrategyUpdate?.(fresh);

      results.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: strategy.symbol,
        placedBefore: beforeOrders,
        placedAfter: afterOrders,
        repaired: afterOrders !== beforeOrders,
      });

      const diff = afterOrders - beforeOrders;
      if (diff > 0) {
        onProgress?.(`${strategy.name}: 补挂了 ${diff} 个订单 (${beforeOrders} → ${afterOrders})`);
      } else if (diff < 0) {
        onProgress?.(`${strategy.name}: 清理了 ${-diff} 个无效订单 (${beforeOrders} → ${afterOrders})`);
      } else {
        onProgress?.(`${strategy.name}: 挂单正常 (${afterOrders} 个)`);
      }
    } catch (err: any) {
      log(strategy.id, `同步失败: ${err.message}`);
      results.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: strategy.symbol,
        placedBefore: beforeOrders,
        placedAfter: beforeOrders,
        repaired: false,
        error: err.message,
      });
      onProgress?.(`${strategy.name}: 同步失败 - ${err.message}`);
    }

    await sleep(500); // 策略间留间隔，避免限频
  }

  return results;
}

// 获取某个策略的执行状态
export function isStrategyExecutorRunning(strategyId: number): boolean {
  return _executors.get(strategyId)?.running || false;
}

// 获取策略的挂单统计
export async function getStrategyOrderStats(strategyId: number) {
  const orders = await db.gridOrders.where('strategyId').equals(strategyId).toArray();
  return {
    total: orders.length,
    placed: orders.filter(o => o.status === 'placed').length,
    filled: orders.filter(o => o.status === 'filled').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    error: orders.filter(o => o.status === 'error').length,
    pending: orders.filter(o => o.status === 'pending').length,
  };
}
