import { decrypt } from './crypto';
import type { NotificationConfig, EventAlert, AlertLevel, ScanBriefing, ScoringResult } from '../types';
import { db } from '../db';
import { getLang, getLocale } from './langUtil';

// ==================== 全局推送设置 (localStorage) ====================
export interface GlobalPushSettings {
  pushScanResults: boolean;
  pushAlerts: boolean;
  alertLevels: AlertLevel[];
  quietHoursStart: string;
  quietHoursEnd: string;
}

const PUSH_SETTINGS_KEY = 'aags-push-settings';

const DEFAULT_PUSH_SETTINGS: GlobalPushSettings = {
  pushScanResults: true,
  pushAlerts: true,
  alertLevels: ['critical', 'warning'],
  quietHoursStart: '',
  quietHoursEnd: '',
};

export function getGlobalPushSettings(): GlobalPushSettings {
  try {
    const raw = localStorage.getItem(PUSH_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_PUSH_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_PUSH_SETTINGS };
}

export function saveGlobalPushSettings(settings: GlobalPushSettings): void {
  localStorage.setItem(PUSH_SETTINGS_KEY, JSON.stringify(settings));
}

// ==================== HTML 转义 ====================
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==================== Telegram 推送 ====================
async function sendTelegram(config: NotificationConfig, message: string): Promise<boolean> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error('Telegram 配置不完整: 缺少 Bot Token 或 Chat ID');
  }

  let token: string;
  try {
    token = decrypt(config.telegramBotToken);
  } catch (e) {
    throw new Error('Bot Token 解密失败，请重新配置');
  }
  if (!token) {
    throw new Error('Bot Token 解密为空，请重新配置');
  }

  const baseUrl = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? '/tgapi'
    : 'https://api.telegram.org';
  const url = `${baseUrl}/bot${token}/sendMessage`;
  console.log('[sendTelegram] URL:', url.replace(token, token.slice(0, 8) + '***'));
  console.log('[sendTelegram] chatId:', config.telegramChatId, ', msgLen:', message.length);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const resText = await res.text();
    console.log('[sendTelegram] 响应状态:', res.status, ', body:', resText.slice(0, 300));

    if (!res.ok) {
      let detail = resText;
      try {
        const errJson = JSON.parse(resText);
        detail = errJson.description || resText;
      } catch {}
      throw new Error(`Telegram API 返回 ${res.status}: ${detail}`);
    }

    // 检查 Telegram JSON 返回的 ok 字段
    try {
      const json = JSON.parse(resText);
      if (json.ok === false) {
        throw new Error(`Telegram API 返回 ok=false: ${json.description || resText}`);
      }
    } catch (parseErr: any) {
      if (parseErr.message?.includes('Telegram API')) throw parseErr;
      // 非 JSON 但 HTTP 200，视为成功
    }

    return true;
  } catch (err: any) {
    if (err.message?.includes('Telegram API')) throw err;
    throw new Error(`网络请求失败: ${err.message}`);
  }
}

// ==================== WhatsApp 推送 ====================
async function sendWhatsApp(config: NotificationConfig, message: string): Promise<boolean> {
  if (!config.whatsappApiUrl || !config.whatsappApiKey || !config.whatsappPhone) {
    throw new Error('WhatsApp 配置不完整');
  }

  let apiKey: string;
  try {
    apiKey = decrypt(config.whatsappApiKey);
  } catch {
    throw new Error('WhatsApp API Key 解密失败，请重新配置');
  }

  try {
    const res = await fetch(config.whatsappApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: config.whatsappPhone,
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WhatsApp API 返回 ${res.status}: ${errText}`);
    }
    return true;
  } catch (err: any) {
    if (err.message?.includes('WhatsApp API')) throw err;
    throw new Error(`网络请求失败: ${err.message}`);
  }
}

// ==================== 免打扰时段检查 (全局设置) ====================
function isQuietHoursGlobal(gps: GlobalPushSettings): boolean {
  if (!gps.quietHoursStart || !gps.quietHoursEnd) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = gps.quietHoursStart.split(':').map(Number);
  const [endH, endM] = gps.quietHoursEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // 跨午夜 e.g. 23:00 - 07:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

// ==================== 格式化预警消息 ====================
function formatAlertMessage(alert: EventAlert): string {
  const levelEmoji: Record<AlertLevel, string> = {
    critical: '🚨',
    warning: '⚠️',
    info: 'ℹ️',
  };
  const isZh = getLang() === 'zh';
  const levelLabel: Record<AlertLevel, string> = {
    critical: isZh ? '紧急预警' : 'Critical Alert',
    warning: isZh ? '重要提醒' : 'Warning',
    info: isZh ? '信息通知' : 'Info',
  };

  const emoji = levelEmoji[alert.level];
  const label = levelLabel[alert.level];
  const coinsLabel = isZh ? '相关币种' : 'Related';
  const coins = alert.relatedCoins.length > 0 ? `\n${coinsLabel}: ${alert.relatedCoins.join(', ')}` : '';
  const time = new Date(alert.createdAt).toLocaleString(getLocale());
  const scoreInfo = alert.scoreSnapshot
    ? `\nSD: ${alert.scoreSnapshot.sd.toFixed(1)} | SV: ${alert.scoreSnapshot.sv.toFixed(1)} | SR: ${alert.scoreSnapshot.sr.toFixed(1)}`
    : '';
  const groupLabel = isZh ? '信号组' : 'Group';
  const sourceLabel = isZh ? '来源' : 'Source';
  const timeLabel = isZh ? '时间' : 'Time';

  return `${emoji} <b>[Sentinel-X ${label}]</b>

<b>${alert.title}</b>

${alert.description}

${groupLabel}: ${alert.group}${scoreInfo}${coins}
${sourceLabel}: ${alert.source}
${timeLabel}: ${time}`;
}

// ==================== 主推送函数 ====================
export async function notifyAlert(alert: EventAlert): Promise<string[]> {
  const configs = await db.notificationConfigs.filter(c => c.enabled).toArray();
  if (configs.length === 0) return [];

  const message = formatAlertMessage(alert);
  const successChannels: string[] = [];

  const gps = getGlobalPushSettings();

  for (const config of configs) {
    // 检查全局是否启用预警推送
    if (!gps.pushAlerts) continue;

    // 检查全局推送级别
    if (!gps.alertLevels.includes(alert.level)) continue;

    // 免打扰时段: critical 级别无视免打扰
    if (alert.level !== 'critical' && isQuietHoursGlobal(gps)) continue;

    let success = false;
    if (config.channel === 'telegram') {
      success = await sendTelegram(config, message);
    } else if (config.channel === 'whatsapp') {
      // WhatsApp 不支持 HTML，转为纯文本
      const plainMsg = message.replace(/<\/?[^>]+>/g, '');
      success = await sendWhatsApp(config, plainMsg);
    }

    if (success) {
      successChannels.push(config.channel);
    }
  }

  // 标记为已推送
  if (successChannels.length > 0 && alert.id) {
    await db.eventAlerts.update(alert.id, {
      notified: true,
      notifyChannels: successChannels,
    });
  }

  return successChannels;
}

// ==================== 批量推送未通知的预警 ====================
export async function notifyPendingAlerts(): Promise<number> {
  const pending = await db.eventAlerts.where('notified').equals(0).toArray();
  let notified = 0;

  for (const alert of pending) {
    const channels = await notifyAlert(alert);
    if (channels.length > 0) notified++;
  }

  return notified;
}

// ==================== 格式化扫描结果消息 ====================
function formatScanResultMessage(briefing: ScanBriefing, scores?: ScoringResult | null): string {
  const isZh = getLang() === 'zh';
  const time = new Date(briefing.timestamp).toLocaleString(getLocale());
  const sigCount = briefing.triggeredSignals.length;
  const alertCount = briefing.alerts.length;
  const bullish = briefing.triggeredSignals.filter(s => s.impact > 0).length;
  const bearish = briefing.triggeredSignals.filter(s => s.impact < 0).length;
  const netImpact = briefing.triggeredSignals.reduce((s, t) => s + t.impact, 0);

  let scoreText = '';
  if (scores) {
    const lbl = isZh ? 'Sentinel-X 评分' : 'Sentinel-X Scores';
    const sd = isZh ? 'SD 方向' : 'SD Direction';
    const sv = isZh ? 'SV 波动' : 'SV Volatility';
    const sr = isZh ? 'SR 风险' : 'SR Risk';
    scoreText = `\n\n📊 <b>${lbl}</b>\n${sd}: ${scores.scoreDirection.toFixed(1)} | ${sv}: ${scores.scoreVolatility.toFixed(1)} | ${sr}: ${scores.scoreRisk.toFixed(1)}`;
  }

  const topSignals = briefing.triggeredSignals
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 5)
    .map(s => `  ${s.impact > 0 ? '📈' : '📉'} ${escapeHtml(s.title)} (${s.impact > 0 ? '+' : ''}${s.impact})`)
    .join('\n');

  const summaryLabel = isZh ? '市场综合分析' : 'Market Analysis';
  const summary = briefing.marketSummary
    ? `\n\n📋 <b>${summaryLabel}</b>\n${escapeHtml(briefing.marketSummary)}`
    : '';

  const title = isZh ? 'Sentinel-X 信号扫描报告' : 'Sentinel-X Signal Scan Report';
  const timeLbl = isZh ? '时间' : 'Time';
  const sigLbl = isZh ? '触发信号' : 'Signals';
  const sigUnit = isZh ? '个' : '';
  const netLbl = isZh ? '净影响' : 'Net Impact';
  const alertLbl = isZh ? '预警' : 'Alerts';
  const alertUnit = isZh ? '条' : '';
  const topLbl = isZh ? '主要信号' : 'Top Signals';

  return `🔍 <b>[${title}]</b>\n\n⏰ ${timeLbl}: ${time}\n📡 ${sigLbl}: ${sigCount}${sigUnit ? ' ' + sigUnit : ''} (📈${bullish} 📉${bearish})\n⚡ ${netLbl}: ${netImpact > 0 ? '+' : ''}${netImpact}\n${alertCount > 0 ? `🚨 ${alertLbl}: ${alertCount}${alertUnit ? ' ' + alertUnit : ''}\n` : ''}${scoreText}${summary}${topSignals ? `\n\n🔥 <b>${topLbl}</b>\n${topSignals}` : ''}`;
}

// ==================== 推送扫描结果 ====================
export async function notifyScanResult(briefing: ScanBriefing, scores?: ScoringResult | null): Promise<string[]> {
  const configs = await db.notificationConfigs.filter(c => c.enabled).toArray();
  console.log('[notifyScanResult] 已启用渠道数:', configs.length);
  if (configs.length === 0) return [];

  const message = formatScanResultMessage(briefing, scores);
  const successChannels: string[] = [];

  const gps = getGlobalPushSettings();
  console.log('[notifyScanResult] 全局设置:', JSON.stringify(gps));

  for (const config of configs) {
    // 检查全局是否启用扫描结果推送
    if (!gps.pushScanResults) { console.log('[notifyScanResult] pushScanResults=false, 跳过'); continue; }

    // 免打扰时段检查
    if (isQuietHoursGlobal(gps)) { console.log('[notifyScanResult] 免打扰时段, 跳过'); continue; }

    let success = false;
    try {
      if (config.channel === 'telegram') {
        success = await sendTelegram(config, message);
      } else if (config.channel === 'whatsapp') {
        const plainMsg = message.replace(/<\/?[^>]+>/g, '');
        success = await sendWhatsApp(config, plainMsg);
      }
    } catch (err) {
      console.warn(`推送扫描结果到 ${config.channel} 失败:`, err);
    }

    if (success) {
      successChannels.push(config.channel);
    }
  }

  return successChannels;
}

// ==================== 测试通知 ====================
export async function testNotification(config: NotificationConfig): Promise<boolean> {
  const isZh = getLang() === 'zh';
  const testMsg = isZh
    ? `✅ <b>[AAGS 通知测试]</b>\n\n通知渠道 ${config.channel === 'telegram' ? 'Telegram' : 'WhatsApp'} 配置成功！\n\n时间: ${new Date().toLocaleString('zh-CN')}`
    : `✅ <b>[AAGS Notification Test]</b>\n\n${config.channel === 'telegram' ? 'Telegram' : 'WhatsApp'} channel configured successfully!\n\nTime: ${new Date().toLocaleString('en-US')}`;

  if (config.channel === 'telegram') {
    return sendTelegram(config, testMsg);
  } else {
    const plainMsg = testMsg.replace(/<\/?[^>]+>/g, '');
    return sendWhatsApp(config, plainMsg);
  }
}

// ==================== 推送扫描失败通知 (如 Token 不足) ====================
export async function notifyScanFailure(reason: string, detail: string): Promise<string[]> {
  const configs = await db.notificationConfigs.filter(c => c.enabled).toArray();
  if (configs.length === 0) return [];

  const isZh = getLang() === 'zh';
  const now = new Date().toLocaleString(getLocale(), { timeZone: 'Asia/Shanghai' });
  const message = [
    `🚨 <b>[${isZh ? 'Sentinel-X 扫描失败' : 'Sentinel-X Scan Failed'}]</b>`,
    ``,
    `⚠️ <b>${isZh ? '原因' : 'Reason'}:</b> ${reason}`,
    detail ? `📋 <b>${isZh ? '详情' : 'Detail'}:</b> ${detail}` : '',
    `🕐 <b>${isZh ? '时间' : 'Time'}:</b> ${now}`,
  ].filter(Boolean).join('\n');

  const successChannels: string[] = [];
  for (const config of configs) {
    try {
      let success = false;
      if (config.channel === 'telegram') {
        success = await sendTelegram(config, message);
      } else if (config.channel === 'whatsapp') {
        success = await sendWhatsApp(config, message.replace(/<\/?[^>]+>/g, ''));
      }
      if (success) successChannels.push(config.channel);
    } catch (err) {
      console.warn(`推送扫描失败通知到 ${config.channel} 失败:`, err);
    }
  }
  return successChannels;
}

// ==================== 诊断测试 (返回每一步详情) ====================
export async function diagnosticTest(config: NotificationConfig): Promise<string> {
  const steps: string[] = [];
  try {
    steps.push(`${getLang() === 'zh' ? '渠道' : 'Channel'}: ${config.channel}`);

    if (config.channel === 'telegram') {
      if (!config.telegramBotToken) return '❌ Bot Token 为空';
      if (!config.telegramChatId) return '❌ Chat ID 为空';

      let token: string;
      try {
        token = decrypt(config.telegramBotToken);
        steps.push(`Token 解密: 成功 (${token.slice(0, 6)}...${token.slice(-4)})`);
      } catch (e: any) {
        return `❌ Token 解密失败: ${e.message}`;
      }
      if (!token) return '❌ Token 解密为空';

      const baseUrl = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? '/tgapi' : 'https://api.telegram.org';
      const url = `${baseUrl}/bot${token}/sendMessage`;
      steps.push(`API: ${baseUrl}, ChatID: ${config.telegramChatId}`);

      const body = {
        chat_id: config.telegramChatId,
        text: '✅ [AAGS] ' + (getLang() === 'zh' ? '诊断测试消息' : 'Diagnostic test message') + ' - ' + new Date().toLocaleString(getLocale()),
        parse_mode: 'HTML',
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resText = await res.text();
      steps.push(`HTTP ${res.status}`);

      if (res.ok) {
        try {
          const json = JSON.parse(resText);
          if (json.ok) {
            steps.push('✅ Telegram 返回 ok=true');
            return steps.join('\n');
          } else {
            steps.push(`❌ ok=false: ${json.description || resText.slice(0, 200)}`);
            return steps.join('\n');
          }
        } catch {
          steps.push('✅ HTTP 200 (非JSON响应)');
          return steps.join('\n');
        }
      } else {
        steps.push(`❌ ${resText.slice(0, 300)}`);
        return steps.join('\n');
      }
    } else {
      return getLang() === 'zh' ? '仅支持 Telegram 诊断' : 'Only Telegram diagnostics supported';
    }
  } catch (err: any) {
    steps.push(`❌ 异常: ${err.message}`);
    return steps.join('\n');
  }
}

// ==================== 测试推送上次扫描结果 ====================
export async function testScanResultPush(): Promise<{ success: boolean; channels: string[]; error?: string }> {
  try {
    const briefing = await db.scanBriefings.orderBy('receivedAt').reverse().first();
    if (!briefing) {
      return { success: false, channels: [], error: getLang() === 'zh' ? '暂无扫描记录，请先执行一次信号扫描' : 'No scan records yet. Please run a signal scan first.' };
    }

    const configs = await db.notificationConfigs.filter(c => c.enabled).toArray();
    if (configs.length === 0) {
      return { success: false, channels: [], error: getLang() === 'zh' ? '没有已启用的推送渠道' : 'No enabled push channels' };
    }

    console.log('[testScanResultPush] briefing:', briefing.briefingId, 'channels:', configs.length);

    // 获取最近一次评分
    const latestScore = await db.scoringResults.orderBy('timestamp').reverse().first();

    const message = formatScanResultMessage(briefing, latestScore || null);
    console.log('[testScanResultPush] 消息长度:', message.length);
    const successChannels: string[] = [];
    const errors: string[] = [];

    for (const config of configs) {
      try {
        let ok = false;
        if (config.channel === 'telegram') {
          console.log('[testScanResultPush] 发送到 Telegram, chatId:', config.telegramChatId);
          ok = await sendTelegram(config, message);
          console.log('[testScanResultPush] Telegram 结果:', ok);
        } else if (config.channel === 'whatsapp') {
          ok = await sendWhatsApp(config, message.replace(/<\/?[^>]+>/g, ''));
        }
        if (ok) successChannels.push(config.channel);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[testScanResultPush] ${config.channel} 失败:`, errMsg);
        errors.push(`${config.channel}: ${errMsg}`);
      }
    }

    if (successChannels.length === 0 && errors.length > 0) {
      return { success: false, channels: [], error: errors.join('; ') };
    }
    return { success: successChannels.length > 0, channels: successChannels };
  } catch (outerErr: any) {
    console.error('[testScanResultPush] 外层异常:', outerErr);
    return { success: false, channels: [], error: outerErr?.message || String(outerErr) };
  }
}
