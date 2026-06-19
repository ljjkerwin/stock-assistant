import type {
  Strategy,
  StrategyBar,
  StrategyContext,
  StrategyRunResult,
  Trade,
} from './strategy.interface';

/**
 * 经典框架-趋势跟随 + 分层止损。
 *
 * 与 {@link Trend3Strategy} 共用同一套**入场逻辑**（Donchian 突破 + 中期趋势过滤），刻意保持
 * 入场不变，使「止损方式」成为与 trend3 对比时唯一变化的变量，便于 A/B 评估。
 *
 * 唯一改动在**出场**：把 trend3 的单层 ATR 跟踪止损替换为**棘轮式三段止损**（止损位只升不降）：
 * - 初始止损：入场即设 `买价 − {@link INIT_MULT}×ATR(入场日)`，比 trend3 的 3×ATR 更紧，
 *   因为后续有保本止损兜底。
 * - 保本止损：当「入场以来最高收盘 − 买价 ≥ {@link BREAKEVEN_MULT}×ATR(入场日)」时，
 *   把止损上移到买入价，避免盈利单回吐成亏损。
 * - 跟踪止损（chandelier）：始终参考 `最高收盘 − {@link TRAIL_MULT}×ATR(当日)`，
 *   三者取最高作为当前止损。
 *
 * 收盘价跌破当前止损即离场。净效果：早期小亏被 2×ATR 截断，盈利单被保本位保护，
 * 大趋势用 3×ATR 跟随——针对「沃格/中富把利润回吐」的痛点。
 *
 * 趋势过滤、突破入场、shouldHold/cumulHold、末根强制平仓均与 trend3 完全一致。
 * ATR(14)、近 N 日最高收盘由本策略在 bars 序列上自行计算；MA/changePercent 由接口层提供。
 */

/** Donchian 突破回看天数：收盘创近 N 日新高视为突破。 */
const BREAKOUT_LOOKBACK = 20;
/** ATR 计算周期（Wilder 平滑）。 */
const ATR_PERIOD = 14;
/** 初始止损倍数：入场设「买价 − 倍数×ATR(入场日)」。 */
const INIT_MULT = 2;
/** 保本触发倍数：浮盈达「倍数×ATR(入场日)」后止损上移到买入价。 */
const BREAKEVEN_MULT = 1;
/** ATR 跟踪止损倍数：参考「峰值收盘 − 倍数×ATR(当日)」。 */
const TRAIL_MULT = 3;

export class Trend4Strategy implements Strategy {
  readonly id = 'trend4';
  readonly name = '经典框架-趋势跟随+分层止损';

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

    // 入场：regime 成立 + 收盘创近 N 日新高 + 阳线（与 trend3 一致）
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
    let atrEntry = 0;
    let peakClose = 0;
    let stop = 0;
    let stopLabel = '';
    const buyReason = '中期趋势向上（close>MA60 且 MA20>MA60）+ 收盘创近 20 日新高，突破入场';

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
          stop = buyPrice - INIT_MULT * atrEntry;
          stopLabel = `初始止损（买价 − ${INIT_MULT}×ATR）`;
          signals[i] = 'buy';
        }
      } else {
        peakClose = Math.max(peakClose, bar.close);
        // 保本止损：浮盈达标后上移到买入价
        if (peakClose - buyPrice >= BREAKEVEN_MULT * atrEntry && buyPrice > stop) {
          stop = buyPrice;
          stopLabel = '保本止损（止损上移至买入价）';
        }
        // ATR 跟踪止损（chandelier）：峰值收盘 − 倍数×ATR(当日)
        const a = atr[i];
        if (a != null) {
          const trail = peakClose - TRAIL_MULT * a;
          if (trail > stop) {
            stop = trail;
            stopLabel = `ATR 跟踪止损（峰值收盘 − ${TRAIL_MULT}×ATR）`;
          }
        }
        // 收盘跌破当前（棘轮）止损 → 离场
        if (bar.close < stop) {
          position = false;
          trades.push({
            buyTime,
            buyPrice,
            buyReason,
            sellTime: bar.time,
            sellPrice: bar.close,
            sellReason: `收盘跌破${stopLabel}`,
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
