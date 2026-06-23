import type {
  Strategy,
  StrategyBar,
  StrategyContext,
  StrategyRunResult,
  Trade,
} from './strategy.interface';

/**
 * 经典框架-趋势跟随 + 分层止损 + 趋势确认（在 {@link Trend3Strategy} 框架上迭代的稳健版）。
 *
 * 入场沿用 trend3 的「中期趋势过滤（close>MA60 且 MA20>MA60）+ Donchian 突破 + 阳线」，
 * 出场改为**棘轮式三段止损**（止损位只升不降）：① 初始止损 `买价 − initMult×ATR(入场日)`；
 * ② 保本止损——浮盈达 `breakevenMult×ATR(入场日)` 后止损上移到买入价；
 * ③ ATR 跟踪止损（chandelier）`峰值收盘 − trailMult×ATR(当日)`；三者取最高，收盘跌破即离场。
 *
 * 在此之上，针对 64 标的 × 4 区间（涨/跌/震荡）样本暴露的问题做了三处调优：
 *
 * 1）**入场加趋势确认（核心）**：样本显示最大失血点在**下跌市 whipsaw**——regime 过滤
 *    `close>MA60 && MA20>MA60` 在下跌初期/中继反弹仍成立（MA20 尚未跌穿 MA60），于是不断买
 *    突破被止损连续切。故入场额外要求 **MA60 自身向上**（`ma60[i] > ma60[i − ma60SlopeLookback]`），
 *    下跌市 MA60 走平/向下时整段不入场。
 *
 * 2）**跟踪止损放宽**（个股 3→3.5×ATR）：趋势确认提高入场质量后让盈利单跑得更久；初始止损与
 *    保本位保持紧（个股 2×/1×ATR），以护住下跌/震荡市。
 *
 * 3）**个股 vs ETF 双参数集**（`ctx.isEtf` 由接口层按市场/代码推断）：ETF 是低波动篮子、
 *    20 日突破假信号多，故 ETF **仅把 Donchian 突破回看 20→40**，其余参数与个股一致——经 ETF
 *    子样本验证，优于更长(50+)/更短(30)或额外放宽止损。两套参数共用同一套入场/出场逻辑。
 *
 * `shouldHold`（= 中期上升趋势状态）/`cumulHold`、末根强制平仓与 trend3 一致。
 * ATR、近 N 日最高收盘、MA60 斜率由本策略在 bars 序列上自算；MA/changePercent 由接口层提供。
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

/** 个股参数集：紧初始止损/保本位护下跌震荡市，3.5×ATR 跟踪追上涨市。 */
const STOCK_PARAMS: TrendParams = {
  breakoutLookback: 20,
  atrPeriod: 14,
  initMult: 2,
  breakevenMult: 1,
  trailMult: 3.5,
  ma60SlopeLookback: 10,
};

/**
 * ETF 参数集：仅把 Donchian 突破回看 20→40，其余与个股一致。
 * ETF 是低波动篮子、20 日突破假信号多（个股那套在 ETF 下跌市 whipsaw 严重、甚至跑输买入持有），
 * 拉长到 40 日要求更强趋势确认后才入场——经 ETF 子样本验证，下跌市(W1)中位 −13.4%→−4.3%、
 * 回撤中位 4.9%→0.6%、收益均值 0.6%→1.6% 全面改善，仅牛市略让出（慢信号入场偏晚的结构成本）；
 * 实验显示更长(50+)或更短(30)、以及放宽止损均不如 40 + 个股止损这套。
 */
const ETF_PARAMS: TrendParams = {
  breakoutLookback: 40,
  atrPeriod: 14,
  initMult: 2,
  breakevenMult: 1,
  trailMult: 3.5,
  ma60SlopeLookback: 10,
};

export class Trend5Strategy implements Strategy {
  readonly id = 'trend5';
  readonly name = '经典框架-趋势跟随+分层止损+趋势确认';

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
