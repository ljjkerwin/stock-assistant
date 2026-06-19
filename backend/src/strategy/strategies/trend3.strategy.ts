import type {
  Strategy,
  StrategyBar,
  StrategyContext,
  StrategyRunResult,
  Trade,
} from './strategy.interface';

/**
 * 经典框架-趋势跟随（突破入场 + ATR 跟踪止损）。
 *
 * 业界经典的趋势跟随框架（Donchian 突破 + 波动率止损 + 趋势过滤），刻意只用两个标准
 * 参数（突破回看 {@link BREAKOUT_LOOKBACK}、ATR 倍数 {@link ATR_TRAIL_MULT}），不做按
 * 标的/区间的逐个调参，以换取样本外稳健性。
 *
 * - 趋势过滤（regime）：仅在中期趋势向上时做多——close > MA60 且 MA20 > MA60。
 * - 入场：在 regime 成立下，收盘创近 {@link BREAKOUT_LOOKBACK} 日新高（Donchian 突破）
 *   且当日上涨（changePercent > 0）。
 * - 出场：ATR 跟踪止损——收盘价跌破「入场以来最高收盘 − {@link ATR_TRAIL_MULT} × ATR(14)」。
 * - 回测结束仍持仓则以末根收盘价强制平仓（forcedClose，不打卖出信号/不生成卖出记录）。
 *
 * 设计取舍（已用 27 只标的 × 多区间样本外验证）：趋势跟随的价值在于**下跌/震荡市的
 * 回撤保护**（regime 过滤使其在弱势标的上大量空仓），在单边上涨市会**参与但滞后于买入
 * 持有**，这是趋势跟随的固有特征，并非缺陷。
 *
 * ATR(14)、近 N 日最高收盘均由本策略在 bars 序列上自行计算（依赖回测预热区间）；
 * MA/changePercent 由接口层提供。
 *
 * 随 K 线返回的策略字段：
 * - shouldHold：当前是否处于中期上升趋势（close > MA60 且 MA20 > MA60）；
 * - cumulHold：当前 K 线之前连续 shouldHold 为 true 的根数（不含自身，遇 false 归零）。
 */

/** Donchian 突破回看天数：收盘创近 N 日新高视为突破。 */
const BREAKOUT_LOOKBACK = 20;
/** ATR 计算周期（Wilder 平滑）。 */
const ATR_PERIOD = 14;
/** ATR 跟踪止损倍数：收盘跌破「入场后最高收盘 − 倍数 × ATR」即离场。 */
const ATR_TRAIL_MULT = 3;

export class Trend3Strategy implements Strategy {
  readonly id = 'trend3';
  readonly name = '经典框架-趋势跟随';

  run({ bars, testStartIndex }: StrategyContext): StrategyRunResult {
    const n = bars.length;
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(n).fill(null) as Array<string | null>;

    // ATR(14)，Wilder 平滑：先算真实波幅 TR，再递推
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
        if (i < ATR_PERIOD) {
          sumTr += tr;
          if (i === ATR_PERIOD - 1) atr[i] = sumTr / ATR_PERIOD;
        } else {
          atr[i] = ((atr[i - 1] as number) * (ATR_PERIOD - 1) + tr) / ATR_PERIOD;
        }
      }
    }

    // 近 BREAKOUT_LOOKBACK 日最高收盘（不含当根），用于突破判定
    const priorHigh = Array(n).fill(null) as Array<number | null>;
    for (let i = 0; i < n; i++) {
      if (i < BREAKOUT_LOOKBACK) continue;
      let hh = -Infinity;
      for (let k = i - BREAKOUT_LOOKBACK; k < i; k++) hh = Math.max(hh, bars[k].close);
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

    // 入场：regime 成立 + 收盘创近 N 日新高 + 阳线
    const isEntry = (bar: StrategyBar, i: number): boolean => {
      const { ma20, ma60 } = bar.ma;
      const ph = priorHigh[i];
      if (ma20 == null || ma60 == null || ph == null) return false;
      return (
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
    let peakClose = 0;
    const buyReason = '中期趋势向上（close>MA60 且 MA20>MA60）+ 收盘创近 20 日新高，突破入场';

    for (let i = Math.max(1, testStartIndex); i < n; i++) {
      const bar = bars[i];
      if (!position) {
        if (isEntry(bar, i)) {
          position = true;
          buyTime = bar.time;
          buyPrice = bar.close;
          peakClose = bar.close;
          signals[i] = 'buy';
        }
      } else {
        peakClose = Math.max(peakClose, bar.close);
        const a = atr[i];
        // ATR 跟踪止损：收盘跌破「入场后最高收盘 − 倍数×ATR」
        if (a != null && bar.close < peakClose - ATR_TRAIL_MULT * a) {
          position = false;
          trades.push({
            buyTime,
            buyPrice,
            buyReason,
            sellTime: bar.time,
            sellPrice: bar.close,
            sellReason: `收盘跌破 ATR 跟踪止损（峰值收盘 − ${ATR_TRAIL_MULT}×ATR）`,
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
