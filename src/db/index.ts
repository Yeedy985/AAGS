import Dexie, { type Table } from 'dexie';
import type {
  ApiConfig, Strategy, GridOrder, TradeRecord, EquitySnapshot,
  SignalDefinition, SignalEvent, ScoringResult,
  EventAlert, LLMConfig, NotificationConfig,
  PublicServiceConfig, ScanBriefing, TradeContext,
} from '../types';

class AAGSDatabase extends Dexie {
  apiConfigs!: Table<ApiConfig>;
  strategies!: Table<Strategy>;
  gridOrders!: Table<GridOrder>;
  tradeRecords!: Table<TradeRecord>;
  equitySnapshots!: Table<EquitySnapshot>;
  signalDefinitions!: Table<SignalDefinition>;
  signalEvents!: Table<SignalEvent>;
  scoringResults!: Table<ScoringResult>;
  eventAlerts!: Table<EventAlert>;
  llmConfigs!: Table<LLMConfig>;
  notificationConfigs!: Table<NotificationConfig>;
  publicServiceConfigs!: Table<PublicServiceConfig>;
  scanBriefings!: Table<ScanBriefing>;
  scanFailures!: Table<{ id?: number; timestamp: number; reason: string; errorDetail: string; mode: string }>;
  tradeContexts!: Table<TradeContext>;

  constructor() {
    super('aags-db');
    this.version(1).stores({
      apiConfigs: '++id, label',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
    });

    this.version(2).stores({
      apiConfigs: '++id, label, exchange',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
    }).upgrade(tx => {
      return tx.table('apiConfigs').toCollection().modify(config => {
        if (!config.exchange) {
          config.exchange = 'binance';
        }
      });
    });

    // v3: 旧版舆情 (保留用于升级过渡)
    this.version(3).stores({
      apiConfigs: '++id, label, exchange',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
      sentimentWatchItems: '++id, category, enabled, createdAt',
      sentimentResults: '++id, watchItemId, category, direction, impact, timestamp',
      eventAlerts: '++id, level, notified, createdAt',
      llmConfigs: '++id, provider, enabled',
      notificationConfigs: '++id, channel, enabled',
    });

    // v4: Sentinel-X 300信号评分系统 (替换旧版舆情)
    this.version(4).stores({
      apiConfigs: '++id, label, exchange',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
      sentimentWatchItems: null,  // 删除旧表
      sentimentResults: null,     // 删除旧表
      signalDefinitions: '++id, signalId, group, category, enabled',
      signalEvents: '++id, signalId, group, category, triggeredAt',
      scoringResults: '++id, timestamp',
      eventAlerts: '++id, level, group, notified, createdAt',
      llmConfigs: '++id, provider, enabled',
      notificationConfigs: '++id, channel, enabled',
    });

    // v5: 双模式 — 公共服务 + 简报存储
    this.version(5).stores({
      apiConfigs: '++id, label, exchange',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
      signalDefinitions: '++id, signalId, group, category, enabled',
      signalEvents: '++id, signalId, group, category, triggeredAt',
      scoringResults: '++id, timestamp',
      eventAlerts: '++id, level, group, notified, createdAt',
      llmConfigs: '++id, provider, enabled',
      notificationConfigs: '++id, channel, enabled',
      publicServiceConfigs: '++id, enabled',
      scanBriefings: '++id, briefingId, mode, timestamp, receivedAt, notified',
    });

    // v6: 扫描失败记录
    this.version(6).stores({
      apiConfigs: '++id, label, exchange',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
      signalDefinitions: '++id, signalId, group, category, enabled',
      signalEvents: '++id, signalId, group, category, triggeredAt',
      scoringResults: '++id, timestamp',
      eventAlerts: '++id, level, group, notified, createdAt',
      llmConfigs: '++id, provider, enabled',
      notificationConfigs: '++id, channel, enabled',
      publicServiceConfigs: '++id, enabled',
      scanBriefings: '++id, briefingId, mode, timestamp, receivedAt, notified',
      scanFailures: '++id, timestamp, reason',
    });

    // v7: 交易状态机 (Phase 0.5)
    this.version(7).stores({
      apiConfigs: '++id, label, exchange',
      strategies: '++id, symbol, status, createdAt',
      gridOrders: '++id, strategyId, layer, status, binanceOrderId',
      tradeRecords: '++id, strategyId, layer, timestamp',
      equitySnapshots: '++id, strategyId, timestamp',
      signalDefinitions: '++id, signalId, group, category, enabled',
      signalEvents: '++id, signalId, group, category, triggeredAt',
      scoringResults: '++id, timestamp',
      eventAlerts: '++id, level, group, notified, createdAt',
      llmConfigs: '++id, provider, enabled',
      notificationConfigs: '++id, channel, enabled',
      publicServiceConfigs: '++id, enabled',
      scanBriefings: '++id, briefingId, mode, timestamp, receivedAt, notified',
      scanFailures: '++id, timestamp, reason',
      tradeContexts: '++id, coin, state, updatedAt',
    });
  }
}

export const db = new AAGSDatabase();
