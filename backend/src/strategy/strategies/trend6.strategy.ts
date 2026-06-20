import type {
  Strategy,
  StrategyBar,
  StrategyContext,
  StrategyRunResult,
  Trade,
} from './strategy.interface';

/**
 * 经典框架-趋势跟随 + 分层止损 + 趋势确认 + MA20 离场（在 {@link Trend5Strategy} 基础上加一道卖点）。
 *
 * 入场、棘轮三段止损、MA60 斜率趋势确认、个股/ETF 双参数集均与 trend5 完全一致，**唯一新增**：
 * 持仓期间「**收盘跌破 MA20 即离场**」，与原棘轮止损取**先触发者**。由于 MA20 通常高于 ATR 跟踪止损位，
 * 该条件多数情况下会更早触发——即用更敏感的均线离场换取更快止盈/止损、更小的利润回吐，
 * 代价是趋势中途的正常回踩到 MA20 可能被洗出。是否优于 trend5 由多区间样本回测判定。
 *
 * 其余（shouldHold/cumulHold、末根强制平仓、ATR/突破/斜率自算口径）与 trend5 一致。
 */

/** 一套趋势跟随 + 分层止损参数。 */
interface TrendParams {
  /** Donchian 突破回看天数：收盘创近 N 日新高视为突破。 */
  breakoutLookback: number;
  /** ATR 计算周期（Wilder 平滑）。 */
  atrPeriod: number;
  /** 初始止损倍数：入场设「买价 − 倍数×ATR(入场日)」。 */
  initMult: number;
  /** 保本触发倍数：浮盈达「倍数×ATR(入场日)」后止损上移到买入价。 */
  breakevenMult: number;
  /** ATR 跟踪止损倍数：参考「峰值收盘 − 倍数×ATR(当日)」。 */
  trailMult: number;
  /** MA60 斜率回看天数：要求 `ma60[i] > ma60[i − N]`（中期均线向上）才允许入场。 */
  ma60SlopeLookback: number;
}

/** 个股参数集（与 trend5 一致）。 */
const STOCK_PARAMS: TrendParams = {
  breakoutLookback: 20,
  atrPeriod: 14,
  initMult: 2,
  breakevenMult: 1,
  trailMult: 3.5,
  ma60SlopeLookback: 10,
};

/** ETF 参数集（与 trend5 一致，仅突破回看 40）。 */
const ETF_PARAMS: TrendParams = {
  breakoutLookback: 40,
  atrPeriod: 14,
  initMult: 2,
  breakevenMult: 1,
  trailMult: 3.5,
  ma60SlopeLookback: 10,
};

export class Trend6Strategy implements Strategy {
  readonly id = 'trend6';
  readonly name = '经典框架-趋势跟随+趋势确认+MA20离场';

  run({ bars, testStartIndex, isEtf }: StrategyContext): StrategyRunResult {
    const P = isEtf ? ETF_PARAMS : STOCK_PARAMS;
    const n = bars.length;
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(n).fill(null) as Array<string | null>;

    // ATR，Wilder 平滑：先算真实波幅 TR，再递推
    const atr = Array(n).fill(null) as Array<number | null>;
    {
      let sumTr = 0;
      for (let i = 0; i < n; i++) {
        const prevClose = i > 0 ? bars[i - 1].close : bars[i].close;
        const tr = Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - prevClose),
          Math.abs(bars[i].low - prevClose),
        );
        if (i < P.atrPeriod) {
          sumTr += tr;
          if (i === P.atrPeriod - 1) atr[i] = sumTr / P.atrPeriod;
        } else {
          atr[i] = ((atr[i - 1] as number) * (P.atrPeriod - 1) + tr) / P.atrPeriod;
        }
      }
    }

    // 近 breakoutLookback 日最高收盘（不含当根），用于突破判定
    const priorHigh = Array(n).fill(null) as Array<number | null>;
    for (let i = 0; i < n; i++) {
      if (i < P.breakoutLookback) continue;
      let hh = -Infinity;
      for (let k = i - P.breakoutLookback; k < i; k++) hh = Math.max(hh, bars[k].close);
      priorHigh[i] = hh;
    }

    // shouldHold：中期上升趋势状态（close > MA60 且 MA20 > MA60）
    for (let i = 0; i < n; i++) {
      const { ma20, ma60 } = bars[i].ma;
      bars[i].shouldHold = ma20 != null && ma60 != null && bars[i].close > ma60 && ma20 > ma60;
    }
    for (let i = 0; i < n; i++) {
      bars[i].cumulHold = i > 0 && bars[i - 1].shouldHold ? (bars[i - 1].cumulHold ?? 0) + 1 : 0;
    }

    // 入场：regime 成立 + 收盘创近 N 日新高 + 阳线 + MA60 向上（趋势确认）
    const isEntry = (bar: StrategyBar, i: number): boolean => {
      const { ma20, ma60 } = bar.ma;
      const ph = priorHigh[i];
      if (ma20 == null || ma60 == null || ph == null) return false;
      const ma60Prev = i >= P.ma60SlopeLookback ? bars[i - P.ma60SlopeLookback].ma.ma60 : null;
      const ma60Rising = ma60Prev != null && ma60 > ma60Prev;
      return (
        ma60Rising &&
        bar.close > ma60 &&
        ma20 > ma60 &&
        bar.close >= ph &&
        bar.changePercent != null &&
        bar.changePercent > 0
      );
    };

    let position = false;
    let buyTime = '';
    let buyPrice = 0;
    let atrEntry = 0;
    let peakClose = 0;
    let stop = 0;
    let stopLabel = '';
    const buyReason = `中期趋势向上（close>MA60、MA20>MA60 且 MA60 上行）+ 收盘创近 ${P.breakoutLookback} 日新高，突破入场`;

    for (let i = Math.max(1, testStartIndex); i < n; i++) {
      const bar = bars[i];
      if (!position) {
        if (isEntry(bar, i)) {
          const a = atr[i];
          if (a == null) continue; // ATR 未就绪则不入场（正常预热后不会发生）
          position = true;
          buyTime = bar.time;
          buyPrice = bar.close;
          atrEntry = a;
          peakClose = bar.close;
          stop = buyPrice - P.initMult * atrEntry;
          stopLabel = `初始止损（买价 − ${P.initMult}×ATR）`;
          signals[i] = 'buy';
        }
      } else {
        peakClose = Math.max(peakClose, bar.close);
        // 保本止损：浮盈达标后上移到买入价
        if (peakClose - buyPrice >= P.breakevenMult * atrEntry && buyPrice > stop) {
          stop = buyPrice;
          stopLabel = '保本止损（止损上移至买入价）';
        }
        // ATR 跟踪止损（chandelier）：峰值收盘 − 倍数×ATR(当日)
        const a = atr[i];
        if (a != null) {
          const trail = peakClose - P.trailMult * a;
          if (trail > stop) {
            stop = trail;
            stopLabel = `ATR 跟踪止损（峰值收盘 − ${P.trailMult}×ATR）`;
          }
        }
        // 离场：收盘跌破 MA20（新增卖点）或跌破棘轮止损，取先触发者
        const ma20 = bar.ma.ma20;
        const belowMa20 = ma20 != null && bar.close < ma20;
        if (belowMa20 || bar.close < stop) {
          position = false;
          trades.push({
            buyTime,
            buyPrice,
            buyReason,
            sellTime: bar.time,
            sellPrice: bar.close,
            sellReason: belowMa20 ? '收盘跌破 MA20' : `收盘跌破${stopLabel}`,
            profit: bar.close - buyPrice,
          });
          signals[i] = 'sell';
        }
      }
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
