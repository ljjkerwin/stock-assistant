import type { Strategy, StrategyContext, StrategyRunResult, Trade } from './strategy.interface';

/**
 * 抛物线趋势骑乘 + 自适应 Parabolic SAR 离场（id `trend8`）—— 全新独立思路，不在 trend5/6/7 框架上迭代。
 *
 * 适用画像：「先沿趋势骨缓慢上行 → 走着走着加速大涨（抛物线/主升浪）→ 冲到高点后快速回落」
 * 的题材/趋势股。目标是把整段趋势（含最后的垂直拉升）尽量吃满，同时**在顶部尽可能早离场、
 * 少回吐**（利益最大化）。
 *
 * 设计取材（业界成熟做法）：
 * - 抛物线「blow-off top」的公认特征是「加速近乎垂直上行 + 量价高潮 + 随后剧烈反转」，反转又快
 *   又狠；等滞后的均线/固定 ATR 跟踪止损离场会回吐主升浪的大部分浮盈。
 * - Welles Wilder 的 **Parabolic SAR（抛物线止损转向）** 正是为「趋势市」设计的跟踪止损：其
 *   加速因子（AF）随价格每创新高而递增，趋势越走越陡时止损位收得越快——相当于一条「会随趋势
 *   成熟而自动加速上移的动态地板」，能在 blow-off 顶部附近把止损贴到价格下方，先于普通均线/ATR
 *   离场。这是本策略的离场主轴。
 *
 * 与 trend5/6/7 的本质区别（全新框架，非迭代）：
 * - 入场不用 Donchian N 日新高突破，而是「中期趋势骨确立 + 多头排列 + 站上 MA5 + MACD 多头」的
 *   **趋势骑乘式入场**（顺势骑趋势骨，而非追突破）；
 * - 离场不用固定倍数 ATR 棘轮 / MA20 / 涨幅-跌幅衰竭三件套，而用 **Parabolic SAR 单一主轴**，
 *   并对「抛物线过热」自适应**抬高 AF 上限**让止损在主升浪末端收得更紧；
 * - 另设一道**高潮反转日即时离场**（同日落袋）：SAR 以「收盘 < 当日 SAR」判定、对「创新高后当日
 *   暴力反转」天然滞后一根，故当价格已显著乖离 MA20（抛物线）且当日放量大阴线时直接当日收盘离场，
 *   抢在 SAR 之前锁定「冲高回落」当根的利润。
 *
 * 所有判定均为**相对量**（均线大小关系 / 斜率、价格对 MA20 的乖离比率、单日涨跌幅百分比、SAR 与
 * 收盘的相对位置），不含随股价高低失真的绝对阈值，与项目抗过拟合约定一致。
 *
 * shouldHold（中期上升趋势状态）/ cumulHold / 末根强制平仓口径与项目其他趋势策略一致。
 */

/** 一套抛物线骑乘参数。 */
interface TrendParams {
  /** MA60 斜率回看天数：要求 `ma60[i] > ma60[i − N]`（中期均线向上）才允许入场。 */
  ma60SlopeLookback: number;
  /** Parabolic SAR 初始/步进加速因子。 */
  afStart: number;
  afStep: number;
  /** SAR 常态加速因子上限。 */
  afMaxBase: number;
  /** SAR「抛物线过热」时的加速因子上限（收紧止损，贴近顶部离场）。 */
  afMaxHot: number;
  /** 入场时 SAR 初始位取近 N 根最低价（给趋势留出呼吸空间）。 */
  sarInitLookback: number;
  /** 抛物线过热阈值：自入场以来峰值高于 MA20 的乖离（%）达到即视为过热。 */
  extGatePct: number;
  /** 高潮反转日：过热状态下当日跌幅（%，正数）达标 + 阴线即当日离场。 */
  climaxDropPct: number;
}

/** 个股参数集（目标画像，主调优对象）。 */
const STOCK_PARAMS: TrendParams = {
  ma60SlopeLookback: 10,
  afStart: 0.02,
  afStep: 0.02,
  afMaxBase: 0.2,
  afMaxHot: 0.4,
  sarInitLookback: 3,
  extGatePct: 18,
  climaxDropPct: 6,
};

/** ETF 参数集（低波动篮子，过热/高潮阈值相应放低，仅用于泛化，非主调优目标）。 */
const ETF_PARAMS: TrendParams = {
  ma60SlopeLookback: 10,
  afStart: 0.02,
  afStep: 0.02,
  afMaxBase: 0.2,
  afMaxHot: 0.3,
  sarInitLookback: 3,
  extGatePct: 10,
  climaxDropPct: 4,
};

export class Trend8Strategy implements Strategy {
  readonly id = 'trend8';
  readonly name = '抛物线趋势骑乘（Parabolic SAR 自适应离场）';

  run({ bars, testStartIndex, isEtf }: StrategyContext): StrategyRunResult {
    const P = isEtf ? ETF_PARAMS : STOCK_PARAMS;
    const n = bars.length;
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(n).fill(null) as Array<string | null>;

    // shouldHold：中期上升趋势状态（close > MA60 且 MA20 > MA60），口径与项目其他趋势策略一致
    for (let i = 0; i < n; i++) {
      const { ma20, ma60 } = bars[i].ma;
      bars[i].shouldHold = ma20 != null && ma60 != null && bars[i].close > ma60 && ma20 > ma60;
    }
    for (let i = 0; i < n; i++) {
      bars[i].cumulHold = i > 0 && bars[i - 1].shouldHold ? (bars[i - 1].cumulHold ?? 0) + 1 : 0;
    }

    // 入场：中期趋势骨向上（close>MA20>MA60 且 MA60 上行）+ 多头排列站上 MA5 + 当日阳线 + MACD 多头
    const isEntry = (i: number): boolean => {
      const bar = bars[i];
      const { ma5, ma10, ma20, ma60 } = bar.ma;
      if (ma5 == null || ma10 == null || ma20 == null || ma60 == null) return false;
      const ma60Prev = i >= P.ma60SlopeLookback ? bars[i - P.ma60SlopeLookback].ma.ma60 : null;
      const ma60Rising = ma60Prev != null && ma60 > ma60Prev;
      return (
        ma60Rising &&
        bar.close > ma20 &&
        ma20 > ma60 &&
        ma5 > ma10 && // 多头排列（快线在上）
        bar.close > ma5 && // 站上最快均线
        bar.changePercent != null &&
        bar.changePercent > 0 && // 当日阳线
        bar.macd.dif > bar.macd.dea &&
        bar.macd.dif > 0 // MACD 零轴上方走强
      );
    };

    let position = false;
    let buyTime = '';
    let buyPrice = 0;
    // Parabolic SAR 运行状态
    let sarPrev = 0; // 昨日（或入场日）SAR
    let ep = 0; // extreme point：自入场以来最高价
    let af = 0; // 当前加速因子
    const buyReason =
      '趋势骨向上（close>MA20>MA60 且 MA60 上行）+ 多头排列站上 MA5 + MACD 多头，顺势骑乘入场';

    for (let i = Math.max(2, testStartIndex); i < n; i++) {
      const bar = bars[i];
      if (!position) {
        if (isEntry(i)) {
          position = true;
          buyTime = bar.time;
          buyPrice = bar.close;
          // SAR 初始化：取近 sarInitLookback 根最低价作为初始止损位（swing low，留呼吸空间）
          let initLow = bar.low;
          for (let k = Math.max(0, i - P.sarInitLookback + 1); k <= i; k++) {
            initLow = Math.min(initLow, bars[k].low);
          }
          sarPrev = initLow;
          ep = bar.high;
          af = P.afStart;
          signals[i] = 'buy';
        }
        continue;
      }

      // ── 持仓中：先算今日 SAR，再判离场，最后更新 EP/AF ──
      let sar = sarPrev + af * (ep - sarPrev);
      // 钳制：SAR 不得高于前两根的最低价（Wilder 规则，避免 SAR 切入近期价格区间）
      sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);

      const ma20 = bar.ma.ma20;
      // 抛物线过热：自入场以来峰值（ep）相对 MA20 的乖离达标
      const extPct = ma20 != null && ma20 > 0 ? (ep / ma20 - 1) * 100 : 0;
      const overheated = extPct >= P.extGatePct;
      // 高潮反转日：过热状态下当日放量大阴线（冲高回落当根），同日落袋抢在 SAR 之前
      const climaxReversal =
        overheated &&
        bar.changePercent != null &&
        bar.changePercent <= -P.climaxDropPct &&
        bar.close < bar.open;
      const belowSar = bar.close < sar;

      if (climaxReversal || belowSar) {
        position = false;
        trades.push({
          buyTime,
          buyPrice,
          buyReason,
          sellTime: bar.time,
          sellPrice: bar.close,
          sellReason: climaxReversal
            ? `高潮反转日（峰值乖离 MA20 ≥ ${P.extGatePct}% 后当日跌幅 ≥ ${P.climaxDropPct}% 阴线）`
            : '收盘跌破 Parabolic SAR',
          profit: bar.close - buyPrice,
        });
        signals[i] = 'sell';
        continue;
      }

      // 未离场：更新 EP / AF（创新高才加速；过热时抬高 AF 上限，主升浪末端止损收得更紧）
      if (bar.high > ep) {
        ep = bar.high;
        const afMax = overheated ? P.afMaxHot : P.afMaxBase;
        af = Math.min(af + P.afStep, afMax);
      }
      sarPrev = sar;
    }

    if (position && n > 0) {
      const lastBar = bars[n - 1];
      trades.push({
        buyTime,
        buyPrice,
        buyReason,
        sellTime: lastBar.time,
        sellPrice: lastBar.close,
        sellReason: '策略回测结束，强制平仓',
        profit: lastBar.close - buyPrice,
        forcedClose: true,
      });
    }

    return { trades, signals };
  }
}
