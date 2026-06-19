import type {
  Strategy,
  StrategyBar,
  StrategyContext,
  StrategyRunResult,
  Trade,
} from './strategy.interface';

/**
 * 日线趋势策略。
 *
 * 基于接口层计算的「ljj 综合属性」判断每根 K 线是否值得持仓：
 *   shouldHold = KMACD && KRSI && KMA（三个属性同时满足）。
 * - 回测起点若 shouldHold 已为 true 且当根 K 线强度达标（changePercent > 0），立即建仓；
 * - 此后买入需「shouldHold 由 false→true」且当根强度达标；
 * - 卖出为「shouldHold 由 true→false」（与买入互斥，同一根 K 线不同时触发）；
 * - 回测结束仍持仓则以末根收盘价强制平仓（forcedClose，不打卖出信号/不生成卖出记录）。
 */
export class TrendStrategy implements Strategy {
  readonly id = 'trend';
  readonly name = '日线趋势策略';

  run({ bars, testStartIndex }: StrategyContext): StrategyRunResult {
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(bars.length).fill(null) as Array<string | null>;
    let position = false;
    let buyTime = '';
    let buyPrice = 0;
    let buyReason = '';

    // 第一步：为所有 K 线预计算 shouldHold（综合属性 KMACD+KRSI+KMA 同时满足时值得持仓）
    for (let i = 0; i < bars.length; i++) {
      const { kmacd, krsi, kma } = bars[i].attrs;
      bars[i].shouldHold = kmacd && krsi && kma;
    }

    // cumulHold：当前 K 线之前连续 shouldHold 的根数（不含自身，遇 false 归零）
    // 递推 cumulHold[i] = shouldHold[i-1] ? cumulHold[i-1] + 1 : 0，首根为 0
    for (let i = 0; i < bars.length; i++) {
      bars[i].cumulHold = i > 0 && bars[i - 1].shouldHold ? (bars[i - 1].cumulHold ?? 0) + 1 : 0;
    }

    // K 线强度过滤：买入要求当日上涨（changePercent > 0），避免在阴线/平盘时买入
    const isStrongCandle = (bar: StrategyBar): boolean =>
      bar.changePercent != null && bar.changePercent > 0;

    // 第二步：回测起点若已处于持仓区间且当根 K 线强度达标，立即买入，不等待穿越信号
    const startBar = bars[testStartIndex];
    if (startBar?.shouldHold && isStrongCandle(startBar)) {
      position = true;
      buyTime = startBar.time;
      buyPrice = startBar.close;
      buyReason = '回测起点 shouldHold 为 true 且 K 线强度达标，立即建仓';
      signals[testStartIndex] = 'buy';
    }

    // 第三步：逐根 K 线处理买卖信号（从 testStartIndex + 1 开始）
    for (let i = Math.max(1, testStartIndex + 1); i < bars.length; i++) {
      const bar = bars[i];
      const prevBar = bars[i - 1];

      if (bar.ma.ma5 == null || bar.ma.ma10 == null) continue;

      // 买入：shouldHold 由 false 转为 true，且当根 K 线强度达标（避免中阴线买入）
      if (!position && !prevBar.shouldHold && bar.shouldHold && isStrongCandle(bar)) {
        position = true;
        buyTime = bar.time;
        buyPrice = bar.close;
        buyReason = 'shouldHold 由 false 转为 true 且 K 线强度达标';
        signals[i] = 'buy';
      } else if (position && !bar.shouldHold) {
        // 卖出：shouldHold 转为 false（与买入互斥，同一根 K 线不同时触发）
        position = false;
        trades.push({
          buyTime,
          buyPrice,
          buyReason,
          sellTime: bar.time,
          sellPrice: bar.close,
          sellReason: 'shouldHold 由 true 转为 false',
          profit: bar.close - buyPrice,
        });
        signals[i] = 'sell';
      }
    }

    // 如果还有未平仓位置，以最后一根K线收盘价平仓
    // 该末根平仓标记为 forcedClose：仅用于计算回测收益，不在图表上打卖出信号、也不生成卖出交易记录
    if (position && bars.length > 0) {
      const lastBar = bars[bars.length - 1];
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
