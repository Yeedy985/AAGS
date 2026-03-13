/**
 * Hard Signal Engine — 硬信号触发引擎
 * 
 * "数据驱动触发，AI驱动解释"
 * 
 * 从免费 API 采集实时市场数据，通过硬阈值自动触发 G4/G5/G6/G7 信号，
 * 生成 SignalEvent 注入评分引擎，消除 LLM 延迟和主观性。
 * 所有规则实现动态 Impact (阶段2): 根据偏离幅度分 3-7 档。
 * 
 * 数据源 (13个并发采集):
 * - Binance Futures API (免费): BTC/ETH 资金费率、OI、多空比、Taker比
 * - Binance Spot API (免费): BTC/ETH 价格/成交量/涨跌幅、盘口深度
 * - Alternative.me (免费): Fear & Greed Index
 * - CoinGecko (免费): BTC Dominance、总市值、稳定币市值
 * - DeFi Llama (免费): DeFi TVL
 * 
 * 信号覆盖 (20条硬规则):
 * - G4 机构资金流: #116 稳定币总市值
 * - G5 链上物理流: #156 DeFi TVL
 * - G6 市场结构: #161/#162 资金费率, #166/#167 OI, #169 多空比,
 *                #174/#175 盘口深度, #177 价格波动, #178 现货深度,
 *                #185 现货/OI比, #187 杠杆率, #188 Taker比
 * - G7 情绪指标: #191 恐慌贪婪, #203 山寨季, #204 BTC占比, #212 多空账户比
 */

import type { SignalEvent, SignalGroup } from '../types';

const isDev = import.meta.env.DEV;

// ==================== API URL Helpers ====================
function binanceFuturesUrl(path: string): string {
  return isDev ? `/proxy/binance-futures${path}` : `https://fapi.binance.com${path}`;
}
function binanceSpotUrl(path: string): string {
  return isDev ? `/proxy/binance${path}` : `https://api.binance.com${path}`;
}
function alternativeUrl(path: string): string {
  return isDev ? `/dataapi/alternative${path}` : `https://api.alternative.me${path}`;
}
function coingeckoUrl(path: string): string {
  return isDev ? `/dataapi/coingecko${path}` : `https://api.coingecko.com${path}`;
}

// ==================== 原始数据类型 ====================
export interface HardMarketData {
  timestamp: number;
  // Binance Futures
  btcFundingRate: number | null;     // BTC 永续资金费率
  ethFundingRate: number | null;     // ETH 永续资金费率
  btcOpenInterest: number | null;    // BTC 未平仓合约 (USDT)
  ethOpenInterest: number | null;    // ETH 未平仓合约 (USDT)
  btcLongShortRatio: number | null;  // BTC 多空比 (顶级交易者)
  btcTakerRatio: number | null;      // BTC Taker买卖比
  // Binance Spot
  btcPrice: number | null;
  ethPrice: number | null;
  btcVolume24h: number | null;       // BTC 24h成交量 (USDT)
  btcPriceChangePercent24h: number | null; // BTC 24h涨跌幅 %
  ethVolume24h: number | null;       // ETH 24h成交量 (USDT)
  btcBidDepth: number | null;        // 买盘深度 (±1%)
  btcAskDepth: number | null;        // 卖盘深度 (±1%)
  // Alternative.me
  fearGreedIndex: number | null;     // 恐慌贪婪指数 0-100
  fearGreedClass: string | null;
  // CoinGecko Global
  btcDominance: number | null;       // BTC 市值占比 %
  totalMarketCap: number | null;     // 加密总市值 USD
  totalVolume24h: number | null;     // 全市场24h成交量 USD
  stablecoinMarketCap: number | null; // 稳定币总市值 USD (USDT+USDC+DAI+BUSD)
  ethGasGwei: number | null;         // ETH Gas 平均 Gwei (来自etherscan或fallback)
  // DeFi Llama
  defiTvl: number | null;            // DeFi TVL 总量 USD
  // 衍生计算
  btcSpotVolumeToOI: number | null;  // 现货成交量/OI比 (健康度指标)
  // 采集错误
  errors: string[];
}

// ==================== 硬信号触发规则 ====================
interface HardSignalRule {
  signalId: number;
  group: SignalGroup;
  name: string;
  category: 'D' | 'V' | 'R';
  halfLife: number;
  evaluate: (data: HardMarketData) => { triggered: boolean; impact: number; confidence: number; summary: string } | null;
}

const HARD_SIGNAL_RULES: HardSignalRule[] = [
  // ============================================================
  // G4 机构资金流 — 来自 CoinGecko
  // ============================================================

  // #116 稳定币总市值变化 (用绝对值阈值判断增长/萎缩)
  {
    signalId: 116, group: 'G4', name: '稳定币总市值', category: 'D', halfLife: 2880,
    evaluate: (d) => {
      if (d.stablecoinMarketCap == null) return null;
      const mcapB = d.stablecoinMarketCap / 1e9;
      // 阶段2动态: 稳定币市值>170B说明大量资金涌入，<130B说明萎缩
      if (mcapB > 180) return { triggered: true, impact: 15, confidence: 0.85, summary: `稳定币总市值 $${mcapB.toFixed(0)}B 极高，大量买盘资金储备` };
      if (mcapB > 160) return { triggered: true, impact: 8, confidence: 0.75, summary: `稳定币总市值 $${mcapB.toFixed(0)}B 偏高，资金充裕` };
      if (mcapB < 120) return { triggered: true, impact: -12, confidence: 0.8, summary: `稳定币总市值 $${mcapB.toFixed(0)}B 偏低，流动性不足` };
      if (mcapB < 100) return { triggered: true, impact: -15, confidence: 0.85, summary: `稳定币总市值 $${mcapB.toFixed(0)}B 极低，严重缺乏流动性` };
      return null;
    },
  },

  // ============================================================
  // G5 链上物理流 — 来自 DeFiLlama
  // ============================================================

  // #156 DeFi TVL 总量变化
  {
    signalId: 156, group: 'G5', name: 'DeFi TVL', category: 'D', halfLife: 1440,
    evaluate: (d) => {
      if (d.defiTvl == null) return null;
      const tvlB = d.defiTvl / 1e9;
      if (tvlB > 200) return { triggered: true, impact: 8, confidence: 0.8, summary: `DeFi TVL $${tvlB.toFixed(0)}B 高位，链上生态繁荣` };
      if (tvlB > 150) return { triggered: true, impact: 4, confidence: 0.7, summary: `DeFi TVL $${tvlB.toFixed(0)}B 健康` };
      if (tvlB < 50) return { triggered: true, impact: -8, confidence: 0.8, summary: `DeFi TVL $${tvlB.toFixed(0)}B 极低，链上活跃度萎缩` };
      if (tvlB < 80) return { triggered: true, impact: -4, confidence: 0.7, summary: `DeFi TVL $${tvlB.toFixed(0)}B 偏低` };
      return null;
    },
  },

  // ============================================================
  // G6 市场结构 — 来自 Binance Futures/Spot
  // ============================================================

  // #161 BTC 永续合约资金费率
  {
    signalId: 161, group: 'G6', name: 'BTC资金费率', category: 'V', halfLife: 120,
    evaluate: (d) => {
      if (d.btcFundingRate == null) return null;
      const rate = d.btcFundingRate;
      const pct = (rate * 100).toFixed(4);
      // 阶段2动态: 5档 impact 根据费率绝对值
      if (rate > 0.003)  return { triggered: true, impact: -15, confidence: 0.95, summary: `BTC资金费率极端 ${pct}%，多头疯狂杠杆→强回调信号` };
      if (rate > 0.001)  return { triggered: true, impact: -12, confidence: 0.9, summary: `BTC资金费率极高 ${pct}%，多头过度杠杆` };
      if (rate > 0.0005) return { triggered: true, impact: -6, confidence: 0.8, summary: `BTC资金费率偏高 ${pct}%，多头情绪过热` };
      if (rate < -0.003)  return { triggered: true, impact: 15, confidence: 0.95, summary: `BTC资金费率极端负 ${pct}%，历史级恐慌→强反转` };
      if (rate < -0.001)  return { triggered: true, impact: 12, confidence: 0.9, summary: `BTC资金费率极低 ${pct}%，极度恐慌/反转信号` };
      if (rate < -0.0005) return { triggered: true, impact: 6, confidence: 0.8, summary: `BTC资金费率为负 ${pct}%，空头占优/潜在反弹` };
      return null;
    },
  },
  // #162 ETH 永续合约资金费率
  {
    signalId: 162, group: 'G6', name: 'ETH资金费率', category: 'V', halfLife: 120,
    evaluate: (d) => {
      if (d.ethFundingRate == null) return null;
      const rate = d.ethFundingRate;
      const pct = (rate * 100).toFixed(4);
      if (rate > 0.003)  return { triggered: true, impact: -12, confidence: 0.9, summary: `ETH资金费率极端 ${pct}%` };
      if (rate > 0.001)  return { triggered: true, impact: -10, confidence: 0.85, summary: `ETH资金费率极高 ${pct}%` };
      if (rate > 0.0005) return { triggered: true, impact: -5, confidence: 0.75, summary: `ETH资金费率偏高 ${pct}%` };
      if (rate < -0.003)  return { triggered: true, impact: 12, confidence: 0.9, summary: `ETH资金费率极端负 ${pct}%` };
      if (rate < -0.001)  return { triggered: true, impact: 10, confidence: 0.85, summary: `ETH资金费率极低 ${pct}%` };
      if (rate < -0.0005) return { triggered: true, impact: 5, confidence: 0.75, summary: `ETH资金费率为负 ${pct}%` };
      return null;
    },
  },
  // #166 BTC 未平仓合约 OI
  {
    signalId: 166, group: 'G6', name: 'BTC OI', category: 'V', halfLife: 360,
    evaluate: (d) => {
      if (d.btcOpenInterest == null) return null;
      const oiB = d.btcOpenInterest / 1e9;
      if (oiB > 40) return { triggered: true, impact: -10, confidence: 0.85, summary: `BTC OI $${oiB.toFixed(1)}B 极端高位，杠杆泡沫` };
      if (oiB > 30) return { triggered: true, impact: -6, confidence: 0.75, summary: `BTC OI $${oiB.toFixed(1)}B 高位，杠杆风险` };
      if (oiB > 22) return { triggered: true, impact: 3, confidence: 0.65, summary: `BTC OI $${oiB.toFixed(1)}B 活跃` };
      return null;
    },
  },
  // #167 ETH 未平仓合约 OI
  {
    signalId: 167, group: 'G6', name: 'ETH OI', category: 'V', halfLife: 360,
    evaluate: (d) => {
      if (d.ethOpenInterest == null) return null;
      const oiB = d.ethOpenInterest / 1e9;
      if (oiB > 15) return { triggered: true, impact: -8, confidence: 0.8, summary: `ETH OI $${oiB.toFixed(1)}B 极端高位` };
      if (oiB > 10) return { triggered: true, impact: -4, confidence: 0.7, summary: `ETH OI $${oiB.toFixed(1)}B 偏高` };
      return null;
    },
  },
  // #169 BTC 多空比
  {
    signalId: 169, group: 'G6', name: 'BTC多空比', category: 'D', halfLife: 120,
    evaluate: (d) => {
      if (d.btcLongShortRatio == null) return null;
      const r = d.btcLongShortRatio;
      if (r > 3.0) return { triggered: true, impact: -12, confidence: 0.85, summary: `多空比极端偏多 ${r.toFixed(2)}，多头严重拥挤` };
      if (r > 2.5) return { triggered: true, impact: -8, confidence: 0.8, summary: `多空比极端偏多 ${r.toFixed(2)}，潜在回调` };
      if (r > 1.8) return { triggered: true, impact: -4, confidence: 0.7, summary: `多空比偏多 ${r.toFixed(2)}` };
      if (r < 0.35) return { triggered: true, impact: 12, confidence: 0.85, summary: `多空比极端偏空 ${r.toFixed(2)}，空头严重拥挤→反弹` };
      if (r < 0.5) return { triggered: true, impact: 8, confidence: 0.8, summary: `多空比极端偏空 ${r.toFixed(2)}，潜在反弹` };
      if (r < 0.7) return { triggered: true, impact: 4, confidence: 0.7, summary: `多空比偏空 ${r.toFixed(2)}` };
      return null;
    },
  },
  // #174 BTC盘口 买±1%深度
  {
    signalId: 174, group: 'G6', name: 'BTC买盘深度', category: 'D', halfLife: 60,
    evaluate: (d) => {
      if (d.btcBidDepth == null || d.btcAskDepth == null) return null;
      const ratio = d.btcBidDepth / (d.btcAskDepth || 1);
      if (ratio > 3.0) return { triggered: true, impact: 15, confidence: 0.9, summary: `买盘深度极强 (${ratio.toFixed(1)}x卖盘)，强力支撑` };
      if (ratio > 2.0) return { triggered: true, impact: 10, confidence: 0.85, summary: `买盘深度远超卖盘 (${ratio.toFixed(1)}x)` };
      if (ratio > 1.5) return { triggered: true, impact: 5, confidence: 0.75, summary: `买盘深度优于卖盘 (${ratio.toFixed(1)}x)` };
      if (ratio < 0.33) return { triggered: true, impact: -15, confidence: 0.9, summary: `买盘极薄 (买/卖=${ratio.toFixed(2)})，卖压极重` };
      if (ratio < 0.5) return { triggered: true, impact: -10, confidence: 0.85, summary: `卖盘远超买盘 (买/卖=${ratio.toFixed(2)})` };
      if (ratio < 0.7) return { triggered: true, impact: -5, confidence: 0.75, summary: `卖盘强于买盘 (买/卖=${ratio.toFixed(2)})` };
      return null;
    },
  },
  // #175 BTC盘口 卖±1%深度
  {
    signalId: 175, group: 'G6', name: 'BTC卖盘深度', category: 'D', halfLife: 60,
    evaluate: (d) => {
      if (d.btcBidDepth == null || d.btcAskDepth == null) return null;
      const ratio = d.btcAskDepth / (d.btcBidDepth || 1);
      if (ratio > 3.0) return { triggered: true, impact: -12, confidence: 0.9, summary: `卖盘极厚 (${ratio.toFixed(1)}x买盘)，上方阻力极大` };
      if (ratio > 2.0) return { triggered: true, impact: -8, confidence: 0.85, summary: `卖盘远超买盘 (${ratio.toFixed(1)}x)` };
      if (ratio < 0.33) return { triggered: true, impact: 12, confidence: 0.9, summary: `卖盘极薄 (卖/买=${ratio.toFixed(2)})，上方无阻力` };
      if (ratio < 0.5) return { triggered: true, impact: 8, confidence: 0.85, summary: `卖盘薄弱 (卖/买=${ratio.toFixed(2)})` };
      return null;
    },
  },
  // #177 交易量突增 (BTC 24h涨跌幅异常 → 波动信号)
  {
    signalId: 177, group: 'G6', name: '价格异常波动', category: 'V', halfLife: 120,
    evaluate: (d) => {
      if (d.btcPriceChangePercent24h == null) return null;
      const pct = Math.abs(d.btcPriceChangePercent24h);
      if (pct > 15) return { triggered: true, impact: 10, confidence: 0.9, summary: `BTC 24h波动 ${d.btcPriceChangePercent24h!.toFixed(1)}%，极端异常` };
      if (pct > 10) return { triggered: true, impact: 8, confidence: 0.85, summary: `BTC 24h波动 ${d.btcPriceChangePercent24h!.toFixed(1)}%，剧烈波动` };
      if (pct > 5) return { triggered: true, impact: 5, confidence: 0.75, summary: `BTC 24h波动 ${d.btcPriceChangePercent24h!.toFixed(1)}%，显著波动` };
      return null;
    },
  },
  // #178 Binance BTC/USDT 现货深度 (用总深度绝对值)
  {
    signalId: 178, group: 'G6', name: 'Binance现货深度', category: 'D', halfLife: 120,
    evaluate: (d) => {
      if (d.btcBidDepth == null || d.btcAskDepth == null) return null;
      const totalDepthM = (d.btcBidDepth + d.btcAskDepth) / 1e6;
      // 深度极低 → 流动性枯竭 → 大波动风险
      if (totalDepthM < 10) return { triggered: true, impact: -8, confidence: 0.8, summary: `±1%深度仅 $${totalDepthM.toFixed(0)}M，流动性极差` };
      if (totalDepthM < 30) return { triggered: true, impact: -3, confidence: 0.7, summary: `±1%深度 $${totalDepthM.toFixed(0)}M，流动性偏低` };
      if (totalDepthM > 150) return { triggered: true, impact: 5, confidence: 0.75, summary: `±1%深度 $${totalDepthM.toFixed(0)}M，流动性充裕` };
      return null;
    },
  },
  // #185 BTC 现货成交量/OI比率
  {
    signalId: 185, group: 'G6', name: '现货/OI比', category: 'V', halfLife: 360,
    evaluate: (d) => {
      if (d.btcSpotVolumeToOI == null) return null;
      const ratio = d.btcSpotVolumeToOI;
      // 比率极低 = 杠杆过高 → 危险
      if (ratio < 0.3) return { triggered: true, impact: -8, confidence: 0.8, summary: `现货/OI比 ${ratio.toFixed(2)} 极低，杠杆远超现货→爆仓风险` };
      if (ratio < 0.5) return { triggered: true, impact: -4, confidence: 0.7, summary: `现货/OI比 ${ratio.toFixed(2)} 偏低，杠杆偏高` };
      if (ratio > 2.0) return { triggered: true, impact: 5, confidence: 0.7, summary: `现货/OI比 ${ratio.toFixed(2)} 高，现货主导/健康` };
      return null;
    },
  },
  // #187 全网杠杆率
  {
    signalId: 187, group: 'G6', name: '估算杠杆率', category: 'R', halfLife: 360,
    evaluate: (d) => {
      if (d.btcOpenInterest == null || d.btcPrice == null) return null;
      const marketCap = d.btcPrice * 19_500_000;
      const lev = d.btcOpenInterest / marketCap;
      const pct = (lev * 100).toFixed(1);
      if (lev > 0.45) return { triggered: true, impact: -12, confidence: 0.9, summary: `杠杆率 ${pct}% 极端，系统性爆仓风险` };
      if (lev > 0.35) return { triggered: true, impact: -8, confidence: 0.85, summary: `杠杆率 ${pct}% 极高，爆仓风险显著` };
      if (lev > 0.25) return { triggered: true, impact: -4, confidence: 0.75, summary: `杠杆率 ${pct}% 偏高` };
      return null;
    },
  },
  // #188 Taker Buy/Sell Volume比
  {
    signalId: 188, group: 'G6', name: '主买/主卖比', category: 'D', halfLife: 120,
    evaluate: (d) => {
      if (d.btcTakerRatio == null) return null;
      const r = d.btcTakerRatio;
      if (r > 1.5) return { triggered: true, impact: 10, confidence: 0.85, summary: `Taker主买极强 (${r.toFixed(2)})，买方碾压` };
      if (r > 1.3) return { triggered: true, impact: 7, confidence: 0.8, summary: `Taker主买远强于主卖 (${r.toFixed(2)})` };
      if (r > 1.1) return { triggered: true, impact: 3, confidence: 0.7, summary: `Taker偏向主买 (${r.toFixed(2)})` };
      if (r < 0.65) return { triggered: true, impact: -10, confidence: 0.85, summary: `Taker主卖极强 (${r.toFixed(2)})，卖方碾压` };
      if (r < 0.75) return { triggered: true, impact: -7, confidence: 0.8, summary: `Taker主卖远强于主买 (${r.toFixed(2)})` };
      if (r < 0.9) return { triggered: true, impact: -3, confidence: 0.7, summary: `Taker偏向主卖 (${r.toFixed(2)})` };
      return null;
    },
  },

  // ============================================================
  // G7 情绪指标 — 来自 Alternative.me / CoinGecko / Binance
  // ============================================================

  // #191 Crypto Fear & Greed Index
  {
    signalId: 191, group: 'G7', name: '恐惧贪婪指数', category: 'D', halfLife: 1440,
    evaluate: (d) => {
      if (d.fearGreedIndex == null) return null;
      const v = d.fearGreedIndex;
      // 阶段2动态: 7档
      if (v <= 5)  return { triggered: true, impact: 12, confidence: 0.95, summary: `恐慌贪婪指数 ${v} (历史极端恐惧)，极强反转信号` };
      if (v <= 10) return { triggered: true, impact: 10, confidence: 0.9, summary: `恐慌贪婪指数 ${v} (极度恐惧)，强反转信号` };
      if (v <= 20) return { triggered: true, impact: 7, confidence: 0.85, summary: `恐慌贪婪指数 ${v} (恐惧)，潜在买入机会` };
      if (v <= 30) return { triggered: true, impact: 4, confidence: 0.75, summary: `恐慌贪婪指数 ${v} (偏恐惧)，情绪低迷` };
      if (v >= 95) return { triggered: true, impact: -12, confidence: 0.95, summary: `恐慌贪婪指数 ${v} (历史极端贪婪)，极强回调信号` };
      if (v >= 85) return { triggered: true, impact: -10, confidence: 0.9, summary: `恐慌贪婪指数 ${v} (极度贪婪)，过热→强回调` };
      if (v >= 75) return { triggered: true, impact: -6, confidence: 0.85, summary: `恐慌贪婪指数 ${v} (贪婪)，注意风险` };
      if (v >= 65) return { triggered: true, impact: -3, confidence: 0.7, summary: `恐慌贪婪指数 ${v} (偏贪婪)，情绪偏热` };
      return null; // 30-65 中性区间不触发
    },
  },
  // #203 山寨币季节指数 (用 BTC Dominance 反推)
  {
    signalId: 203, group: 'G7', name: '山寨币季节', category: 'D', halfLife: 1440,
    evaluate: (d) => {
      if (d.btcDominance == null) return null;
      const dom = d.btcDominance;
      // BTC占比 < 45% 视为山寨季，> 60% 视为BTC主导
      if (dom < 38) return { triggered: true, impact: 8, confidence: 0.8, summary: `BTC占比仅 ${dom.toFixed(1)}%，深度山寨季/资金轮动强烈` };
      if (dom < 45) return { triggered: true, impact: 5, confidence: 0.7, summary: `BTC占比 ${dom.toFixed(1)}%，偏向山寨季` };
      if (dom > 70) return { triggered: true, impact: -6, confidence: 0.8, summary: `BTC占比 ${dom.toFixed(1)}%，极端BTC主导/避险模式` };
      if (dom > 60) return { triggered: true, impact: -3, confidence: 0.7, summary: `BTC占比 ${dom.toFixed(1)}%，BTC主导` };
      return null;
    },
  },
  // #204 BTC Dominance 变化
  {
    signalId: 204, group: 'G7', name: 'BTC占比', category: 'D', halfLife: 720,
    evaluate: (d) => {
      if (d.btcDominance == null) return null;
      const dom = d.btcDominance;
      if (dom > 68) return { triggered: true, impact: -8, confidence: 0.85, summary: `BTC占比 ${dom.toFixed(1)}% 极端高位，避险情绪极强` };
      if (dom > 60) return { triggered: true, impact: -5, confidence: 0.8, summary: `BTC占比 ${dom.toFixed(1)}% 高位，避险情绪强` };
      if (dom > 55) return { triggered: true, impact: -2, confidence: 0.7, summary: `BTC占比 ${dom.toFixed(1)}% 偏高` };
      if (dom < 35) return { triggered: true, impact: 8, confidence: 0.85, summary: `BTC占比 ${dom.toFixed(1)}% 极低，山寨季/极强风险偏好` };
      if (dom < 42) return { triggered: true, impact: 5, confidence: 0.8, summary: `BTC占比 ${dom.toFixed(1)}% 低位，风险偏好强` };
      if (dom < 48) return { triggered: true, impact: 2, confidence: 0.7, summary: `BTC占比 ${dom.toFixed(1)}% 偏低` };
      return null;
    },
  },
  // #212 Binance 合约多空账户比 (复用 Long/Short Ratio 数据)
  {
    signalId: 212, group: 'G7', name: '合约多空账户比', category: 'D', halfLife: 360,
    evaluate: (d) => {
      if (d.btcLongShortRatio == null) return null;
      const r = d.btcLongShortRatio;
      // 极端偏空 → 反转信号(散户看空，反向操作)
      if (r < 0.4) return { triggered: true, impact: 6, confidence: 0.75, summary: `账户多空比极端偏空 ${r.toFixed(2)}，散户看空→潜在反转` };
      // 极端偏多 → 散户FOMO
      if (r > 3.0) return { triggered: true, impact: -6, confidence: 0.75, summary: `账户多空比极端偏多 ${r.toFixed(2)}，散户FOMO→见顶风险` };
      return null;
    },
  },
];

// ==================== 数据采集函数 ====================

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBTCFundingRate(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl('/fapi/v1/premiumIndex?symbol=BTCUSDT'));
    return Number(data.lastFundingRate) || null;
  } catch (e: any) {
    console.warn('[HardSignal] BTC funding rate failed:', e.message);
    return null;
  }
}

async function fetchETHFundingRate(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl('/fapi/v1/premiumIndex?symbol=ETHUSDT'));
    return Number(data.lastFundingRate) || null;
  } catch (e: any) {
    console.warn('[HardSignal] ETH funding rate failed:', e.message);
    return null;
  }
}

async function fetchOpenInterest(symbol: string): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl(`/fapi/v1/openInterest?symbol=${symbol}`));
    return Number(data.openInterest) || null;
  } catch (e: any) {
    console.warn(`[HardSignal] ${symbol} OI failed:`, e.message);
    return null;
  }
}

async function fetchLongShortRatio(): Promise<number | null> {
  try {
    // 顶级交易者多空比 (5分钟)
    const data = await fetchWithTimeout(binanceFuturesUrl('/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'));
    if (Array.isArray(data) && data.length > 0) {
      return Number(data[0].longShortRatio) || null;
    }
    return null;
  } catch (e: any) {
    console.warn('[HardSignal] Long/Short ratio failed:', e.message);
    return null;
  }
}

async function fetchTakerBuySellRatio(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(binanceFuturesUrl('/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1'));
    if (Array.isArray(data) && data.length > 0) {
      return Number(data[0].buySellRatio) || null;
    }
    return null;
  } catch (e: any) {
    console.warn('[HardSignal] Taker ratio failed:', e.message);
    return null;
  }
}

async function fetchTicker24h(symbol: string): Promise<{ price: number; volume: number; changePercent: number } | null> {
  try {
    const data = await fetchWithTimeout(binanceSpotUrl(`/api/v3/ticker/24hr?symbol=${symbol}`));
    return {
      price: Number(data.lastPrice) || 0,
      volume: Number(data.quoteVolume) || 0,
      changePercent: Number(data.priceChangePercent) || 0,
    };
  } catch (e: any) {
    console.warn(`[HardSignal] ${symbol} ticker failed:`, e.message);
    return null;
  }
}

async function fetchOrderBookDepth(): Promise<{ bidDepth: number; askDepth: number } | null> {
  try {
    // 获取盘口深度 (limit=500 覆盖约±1%深度)
    const data = await fetchWithTimeout(binanceSpotUrl('/api/v3/depth?symbol=BTCUSDT&limit=500'));
    const bids: [string, string][] = data.bids || [];
    const asks: [string, string][] = data.asks || [];

    if (bids.length === 0 || asks.length === 0) return null;

    const midPrice = (Number(bids[0][0]) + Number(asks[0][0])) / 2;
    const lowerBound = midPrice * 0.99; // -1%
    const upperBound = midPrice * 1.01; // +1%

    let bidDepth = 0;
    for (const [price, qty] of bids) {
      if (Number(price) >= lowerBound) bidDepth += Number(price) * Number(qty);
    }
    let askDepth = 0;
    for (const [price, qty] of asks) {
      if (Number(price) <= upperBound) askDepth += Number(price) * Number(qty);
    }

    return { bidDepth, askDepth };
  } catch (e: any) {
    console.warn('[HardSignal] Order book failed:', e.message);
    return null;
  }
}

async function fetchFearGreedIndex(): Promise<{ value: number; classification: string } | null> {
  try {
    const data = await fetchWithTimeout(alternativeUrl('/fng/?limit=1'));
    const entry = data.data?.[0];
    if (!entry) return null;
    return {
      value: Number(entry.value) || 50,
      classification: entry.value_classification || 'Neutral',
    };
  } catch (e: any) {
    console.warn('[HardSignal] Fear & Greed failed:', e.message);
    return null;
  }
}

interface CoinGeckoGlobal {
  btcDominance: number | null;
  totalMarketCap: number | null;
  totalVolume24h: number | null;
}

async function fetchCoinGeckoGlobal(): Promise<CoinGeckoGlobal> {
  try {
    const data = await fetchWithTimeout(coingeckoUrl('/api/v3/global'));
    const d = data.data || {};
    return {
      btcDominance: d.market_cap_percentage?.btc || null,
      totalMarketCap: d.total_market_cap?.usd || null,
      totalVolume24h: d.total_volume?.usd || null,
    };
  } catch (e: any) {
    console.warn('[HardSignal] CoinGecko global failed:', e.message);
    return { btcDominance: null, totalMarketCap: null, totalVolume24h: null };
  }
}

async function fetchStablecoinMarketCap(): Promise<number | null> {
  try {
    // CoinGecko: 获取 USDT+USDC 市值
    const data = await fetchWithTimeout(coingeckoUrl('/api/v3/simple/price?ids=tether,usd-coin,dai&vs_currencies=usd&include_market_cap=true'));
    const usdt = data.tether?.usd_market_cap || 0;
    const usdc = data['usd-coin']?.usd_market_cap || 0;
    const dai = data.dai?.usd_market_cap || 0;
    const total = usdt + usdc + dai;
    return total > 0 ? total : null;
  } catch (e: any) {
    console.warn('[HardSignal] Stablecoin mcap failed:', e.message);
    return null;
  }
}

function defillamaUrl(path: string): string {
  return isDev ? `/dataapi/defillama${path}` : `https://api.llama.fi${path}`;
}

async function fetchDefiTVL(): Promise<number | null> {
  try {
    const data = await fetchWithTimeout(defillamaUrl('/v2/historicalChainTvl'));
    // 返回的是数组，取最后一条 = 最新TVL
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[data.length - 1];
      return latest.tvl || null;
    }
    return null;
  } catch (e: any) {
    console.warn('[HardSignal] DeFi TVL failed:', e.message);
    return null;
  }
}

// ==================== 主采集函数 ====================
export async function collectHardMarketData(): Promise<HardMarketData> {
  const errors: string[] = [];

  const [
    btcFundingRate, ethFundingRate,
    btcOI_raw, ethOI_raw,
    btcLongShortRatio, btcTakerRatio,
    btcTicker, ethTicker, depth,
    fearGreed, cgGlobal, stablecoinMcap, defiTvl,
  ] = await Promise.all([
    fetchBTCFundingRate().catch(e => { errors.push(`BTC FR: ${e.message}`); return null; }),
    fetchETHFundingRate().catch(e => { errors.push(`ETH FR: ${e.message}`); return null; }),
    fetchOpenInterest('BTCUSDT').catch(e => { errors.push(`BTC OI: ${e.message}`); return null; }),
    fetchOpenInterest('ETHUSDT').catch(e => { errors.push(`ETH OI: ${e.message}`); return null; }),
    fetchLongShortRatio().catch(e => { errors.push(`L/S Ratio: ${e.message}`); return null; }),
    fetchTakerBuySellRatio().catch(e => { errors.push(`Taker: ${e.message}`); return null; }),
    fetchTicker24h('BTCUSDT').catch(e => { errors.push(`BTC Ticker: ${e.message}`); return null; }),
    fetchTicker24h('ETHUSDT').catch(e => { errors.push(`ETH Ticker: ${e.message}`); return null; }),
    fetchOrderBookDepth().catch(e => { errors.push(`Depth: ${e.message}`); return null; }),
    fetchFearGreedIndex().catch(e => { errors.push(`FGI: ${e.message}`); return null; }),
    fetchCoinGeckoGlobal().catch(e => { errors.push(`CG Global: ${e.message}`); return { btcDominance: null, totalMarketCap: null, totalVolume24h: null }; }),
    fetchStablecoinMarketCap().catch(e => { errors.push(`Stablecoin: ${e.message}`); return null; }),
    fetchDefiTVL().catch(e => { errors.push(`DeFi TVL: ${e.message}`); return null; }),
  ]);

  // OI 从合约数量转换为 USDT
  const btcPrice = btcTicker?.price || null;
  const ethPrice = ethTicker?.price || null;
  const btcOpenInterest = (btcOI_raw != null && btcPrice != null) ? btcOI_raw * btcPrice : null;
  const ethOpenInterest = (ethOI_raw != null && ethPrice != null) ? ethOI_raw * ethPrice : null;

  // 衍生指标: 现货成交量/OI比
  const btcSpotVolumeToOI = (btcTicker?.volume && btcOpenInterest)
    ? btcTicker.volume / btcOpenInterest : null;

  return {
    timestamp: Date.now(),
    btcFundingRate,
    ethFundingRate,
    btcOpenInterest,
    ethOpenInterest,
    btcLongShortRatio,
    btcTakerRatio,
    btcPrice,
    ethPrice,
    btcVolume24h: btcTicker?.volume || null,
    btcPriceChangePercent24h: btcTicker?.changePercent || null,
    ethVolume24h: ethTicker?.volume || null,
    btcBidDepth: depth?.bidDepth || null,
    btcAskDepth: depth?.askDepth || null,
    fearGreedIndex: fearGreed?.value || null,
    fearGreedClass: fearGreed?.classification || null,
    btcDominance: cgGlobal.btcDominance,
    totalMarketCap: cgGlobal.totalMarketCap,
    totalVolume24h: cgGlobal.totalVolume24h,
    stablecoinMarketCap: stablecoinMcap,
    ethGasGwei: null, // 需要 Etherscan API Key, 暂不采集
    defiTvl,
    btcSpotVolumeToOI,
    errors,
  };
}

// ==================== 硬信号触发 ====================

/**
 * 评估所有硬信号规则，返回触发的 SignalEvent 列表
 */
export function evaluateHardSignals(data: HardMarketData): SignalEvent[] {
  const events: SignalEvent[] = [];
  const now = Date.now();

  for (const rule of HARD_SIGNAL_RULES) {
    try {
      const result = rule.evaluate(data);
      if (result && result.triggered) {
        events.push({
          signalId: rule.signalId,
          group: rule.group,
          impact: result.impact,
          confidence: result.confidence,
          category: rule.category,
          halfLife: rule.halfLife,
          triggeredAt: now,
          title: rule.name,
          summary: result.summary,
          source: 'HARD_DATA',
        });
      }
    } catch (e: any) {
      console.warn(`[HardSignal] Rule #${rule.signalId} eval error:`, e.message);
    }
  }

  return events;
}

/**
 * 一站式: 采集数据 + 评估信号
 * 返回硬信号事件列表和原始市场数据
 */
export async function collectAndEvaluateHardSignals(): Promise<{
  events: SignalEvent[];
  marketData: HardMarketData;
}> {
  const marketData = await collectHardMarketData();
  const events = evaluateHardSignals(marketData);

  if (events.length > 0) {
    console.log(`[HardSignal] ${events.length} signals triggered from ${13 - marketData.errors.length}/13 data sources`);
    for (const e of events) {
      console.log(`  #${e.signalId} ${e.title}: impact=${e.impact} conf=${e.confidence} | ${e.summary}`);
    }
  }
  if (marketData.errors.length > 0) {
    console.warn(`[HardSignal] ${marketData.errors.length} data source error(s):`, marketData.errors);
  }

  return { events, marketData };
}

/**
 * 格式化硬数据为简报补充文本
 */
export function formatHardDataSummary(data: HardMarketData): string {
  const lines: string[] = ['## 📡 实时硬数据 (API直连)'];

  if (data.btcPrice != null) {
    lines.push(`BTC: $${data.btcPrice.toLocaleString()}${data.btcPriceChangePercent24h != null ? ` (${data.btcPriceChangePercent24h > 0 ? '+' : ''}${data.btcPriceChangePercent24h.toFixed(1)}% 24h)` : ''}`);
  }
  if (data.ethPrice != null) {
    lines.push(`ETH: $${data.ethPrice.toLocaleString()}`);
  }
  if (data.btcFundingRate != null) {
    lines.push(`BTC资金费率: ${(data.btcFundingRate * 100).toFixed(4)}%`);
  }
  if (data.ethFundingRate != null) {
    lines.push(`ETH资金费率: ${(data.ethFundingRate * 100).toFixed(4)}%`);
  }
  if (data.btcOpenInterest != null) {
    lines.push(`BTC OI: $${(data.btcOpenInterest / 1e9).toFixed(2)}B`);
  }
  if (data.ethOpenInterest != null) {
    lines.push(`ETH OI: $${(data.ethOpenInterest / 1e9).toFixed(2)}B`);
  }
  if (data.btcLongShortRatio != null) {
    lines.push(`BTC多空比: ${data.btcLongShortRatio.toFixed(2)}`);
  }
  if (data.btcTakerRatio != null) {
    lines.push(`Taker买卖比: ${data.btcTakerRatio.toFixed(2)}`);
  }
  if (data.btcBidDepth != null && data.btcAskDepth != null) {
    lines.push(`盘口深度 (±1%): 买 $${(data.btcBidDepth / 1e6).toFixed(1)}M / 卖 $${(data.btcAskDepth / 1e6).toFixed(1)}M`);
  }
  if (data.btcSpotVolumeToOI != null) {
    lines.push(`现货/OI比: ${data.btcSpotVolumeToOI.toFixed(2)}`);
  }
  if (data.fearGreedIndex != null) {
    lines.push(`恐慌贪婪指数: ${data.fearGreedIndex} (${data.fearGreedClass})`);
  }
  if (data.btcDominance != null) {
    lines.push(`BTC市值占比: ${data.btcDominance.toFixed(1)}%`);
  }
  if (data.stablecoinMarketCap != null) {
    lines.push(`稳定币总市值: $${(data.stablecoinMarketCap / 1e9).toFixed(0)}B`);
  }
  if (data.defiTvl != null) {
    lines.push(`DeFi TVL: $${(data.defiTvl / 1e9).toFixed(0)}B`);
  }
  if (data.totalMarketCap != null) {
    lines.push(`加密总市值: $${(data.totalMarketCap / 1e12).toFixed(2)}T`);
  }

  return lines.join('\n');
}
