import type {
  Strategy,
  StrategyBar,
  StrategyContext,
  StrategyRunResult,
  Trade,
} from './strategy.interface';

/**
 * 日线趋势策略2 —— 自适应双模式（趋势骑乘 + 反弹）。
 *
 * 单一固定策略无法同时应对「强趋势单边上涨」与「震荡/阴跌」两类行情，故 v2 内置
 * 行情识别，按当前 K 线自动切换两种模式（互斥，由 MACD 零轴方向与趋势强度区分）：
 *
 * 趋势成熟度指标 TAR = MA20/MA60（中期均线相对长期均线的位置），用于评估趋势/下跌
 * 的严重程度：TAR 越低表示中期均线越深陷长期均线下方（下跌越严重），越高表示中期
 * 越远离长期上方（趋势越过热）。两种模式各用 TAR 设一道「极端行情」门槛抬高开仓要求。
 *
 * 1) 趋势骑乘模式（强趋势）——目标吃住主升浪：
 *    入场需 MA5>MA10>MA20（多头排列）、close>MA10、MA10 拐头向上、阳线、
 *    dif>dea 且 dif 走强、dif>0（MACD 在零轴上方），并通过**强趋势闸门**：
 *    价格乖离 close/MA20 ≥ {@link EXT_GATE} 且 MA20 日斜率 ≥ {@link SLOPE_GATE_PCT}%，
 *    且 **TAR ≤ {@link TAR_OVERHEAT_MAX}**（趋势未过热，避免在中期远离长期时追高）。
 *    出场：close < MA10（骑住趋势到中期均线走坏）。
 *
 * 2) 反弹模式（震荡/阴跌后的底部反转）——目标快进快出、保护利润：
 *    入场需 close>MA10 且 close>MA20、MA5>MA10、MA10 拐头向上、阳线、
 *    dif>dea 且 dif 回升、dif<0（零轴下方金叉，底部反转）、
 *    RSI6 ∈ [{@link REBOUND_RSI_MIN}, {@link REBOUND_RSI_MAX})（反弹需有真实力度，
 *    既不接弱势死猫跳，也不追超买），且 **TAR ≥ {@link TAR_SEVERE_MIN}**
 *    （下跌不至于过于严重，避免在中期均线深陷长期均线下方时接飞刀）。
 *    出场：close < MA5（跌破快线即离场）。
 *
 * TAR 门槛仅在 MA60 可用时生效（历史不足 60 根时不拦截）。
 *
 * 同一根 K 线优先判定趋势模式；两模式以 dif 零轴方向天然互斥。开仓时记录模式，
 * 平仓按对应模式的出场条件执行。回测结束仍持仓则以末根收盘价强制平仓
 * （forcedClose，不打卖出信号/不生成卖出记录）。
 *
 * 闸门用的均为**与价格刻度无关**的相对量（均线大小关系、零轴方向、价格对 MA20 的
 * 乖离比率、MA20 的百分比斜率），不含随股价高低失真的绝对阈值。
 *
 * 随 K 线返回的策略字段：
 * - shouldHold：当前 K 线是否处于趋势向上的可持仓状态（close > MA10 && MA5 > MA10）；
 * - cumulHold：当前 K 线之前连续 shouldHold 为 true 的根数（不含自身，遇 false 归零）。
 */

/** 强趋势闸门：价格相对 MA20 的乖离下限（close/MA20 ≥ 此值才视为强趋势）。 */
const EXT_GATE = 1.06;
/** 强趋势闸门：MA20 日斜率下限（百分比，(MA20/前一日MA20 - 1)*100 ≥ 此值）。 */
const SLOPE_GATE_PCT = 0.6;
/** 反弹模式 RSI6 下限（含）：低于此值视为弱势死猫跳，不入场。 */
const REBOUND_RSI_MIN = 55;
/** 反弹模式 RSI6 上限（不含）：高于此值视为超买，不追高。 */
const REBOUND_RSI_MAX = 70;
/** 趋势成熟度 TAR=MA20/MA60 的过热上限（含）：高于此值视为趋势过热，不追趋势。 */
const TAR_OVERHEAT_MAX = 1.1;
/** 趋势成熟度 TAR=MA20/MA60 的严重下跌下限（含）：低于此值视为深跌，不抢反弹。 */
const TAR_SEVERE_MIN = 0.9;

type EntryMode = 'trend' | 'rebound';

export class Trend2Strategy implements Strategy {
  readonly id = 'trend2';
  readonly name = '日线趋势策略2';

  run({ bars, testStartIndex }: StrategyContext): StrategyRunResult {
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(bars.length).fill(null) as Array<string | null>;
    let position = false;
    let mode: EntryMode = 'rebound';
    let buyTime = '';
    let buyPrice = 0;
    let buyReason = '';

    // 趋势向上的可持仓状态：价格站上 MA10 且 MA5 在 MA10 之上
    for (let i = 0; i < bars.length; i++) {
      const { ma5, ma10 } = bars[i].ma;
      bars[i].shouldHold = ma5 != null && ma10 != null && bars[i].close > ma10 && ma5 > ma10;
    }

    // cumulHold：当前 K 线之前连续 shouldHold 的根数（不含自身，遇 false 归零）
    for (let i = 0; i < bars.length; i++) {
      bars[i].cumulHold = i > 0 && bars[i - 1].shouldHold ? (bars[i - 1].cumulHold ?? 0) + 1 : 0;
    }

    // 趋势骑乘入场：多头排列 + MACD 零轴上方走强 + 通过强趋势闸门（乖离 & MA20 斜率）
    const isTrendEntry = (bar: StrategyBar, prev: StrategyBar): boolean => {
      const { ma5, ma10, ma20 } = bar.ma;
      const prevMa10 = prev.ma.ma10;
      const prevMa20 = prev.ma.ma20;
      if (ma5 == null || ma10 == null || ma20 == null || prevMa10 == null || prevMa20 == null) {
        return false;
      }
      const slopePct = (ma20 / prevMa20 - 1) * 100;
      // 趋势成熟度门槛：MA60 可用时，TAR(=MA20/MA60) 过高视为过热，不追趋势
      const { ma60 } = bar.ma;
      const tarOk = ma60 == null || ma60 === 0 || ma20 / ma60 <= TAR_OVERHEAT_MAX;
      return (
        ma5 > ma10 &&
        ma10 > ma20 &&
        bar.close > ma10 &&
        ma10 > prevMa10 &&
        bar.changePercent != null &&
        bar.changePercent > 0 &&
        bar.macd.dif > bar.macd.dea &&
        bar.macd.dif > prev.macd.dif &&
        bar.macd.dif > 0 &&
        bar.close / ma20 >= EXT_GATE &&
        slopePct >= SLOPE_GATE_PCT &&
        tarOk
      );
    };

    // 反弹入场：站上 MA10/MA20 + 零轴下方金叉回升 + 非超买
    const isReboundEntry = (bar: StrategyBar, prev: StrategyBar): boolean => {
      const { ma5, ma10, ma20, ma60 } = bar.ma;
      if (ma5 == null || ma10 == null || ma20 == null || prev.ma.ma10 == null) return false;
      // 趋势成熟度门槛：MA60 可用时，TAR(=MA20/MA60) 过低视为深跌，不抢反弹（接飞刀）
      const tarOk = ma60 == null || ma60 === 0 || ma20 / ma60 >= TAR_SEVERE_MIN;
      return (
        bar.close > ma10 &&
        bar.close > ma20 &&
        ma5 > ma10 &&
        ma10 > prev.ma.ma10 &&
        bar.changePercent != null &&
        bar.changePercent > 0 &&
        bar.macd.dif > bar.macd.dea &&
        bar.macd.dif > prev.macd.dif &&
        bar.macd.dif < 0 &&
        bar.rsi.rsi6 != null &&
        bar.rsi.rsi6 >= REBOUND_RSI_MIN &&
        bar.rsi.rsi6 < REBOUND_RSI_MAX &&
        tarOk
      );
    };

    // 逐根处理买卖信号（入场为边沿触发，需前一根存在，从 testStartIndex 与 1 的较大值起步）
    for (let i = Math.max(1, testStartIndex); i < bars.length; i++) {
      const bar = bars[i];
      const prevBar = bars[i - 1];

      if (bar.ma.ma5 == null || bar.ma.ma10 == null) continue;

      if (!position) {
        // 同一根优先判定趋势模式（强趋势），否则判定反弹模式
        if (isTrendEntry(bar, prevBar)) {
          position = true;
          mode = 'trend';
          buyTime = bar.time;
          buyPrice = bar.close;
          buyReason = '多头排列 + MACD 零轴上方走强 + 强趋势闸门（乖离/MA20 斜率），趋势骑乘建仓';
          signals[i] = 'buy';
        } else if (isReboundEntry(bar, prevBar)) {
          position = true;
          mode = 'rebound';
          buyTime = bar.time;
          buyPrice = bar.close;
          buyReason = '零轴下方 MACD 金叉回升 + 价格站上 MA10/MA20，底部反转建仓';
          signals[i] = 'buy';
        }
      } else {
        // 出场按开仓模式：趋势骑乘跌破 MA10 离场，反弹跌破 MA5 离场
        const exit =
          mode === 'trend' ? bar.close < bar.ma.ma10 : bar.ma.ma5 != null && bar.close < bar.ma.ma5;
        if (exit) {
          position = false;
          trades.push({
            buyTime,
            buyPrice,
            buyReason,
            sellTime: bar.time,
            sellPrice: bar.close,
            sellReason: mode === 'trend' ? '收盘价跌破 MA10' : '收盘价跌破 MA5',
            profit: bar.close - buyPrice,
          });
          signals[i] = 'sell';
        }
      }
    }

    // 回测结束仍持仓时以末根收盘价强制平仓（仅计入收益，不打卖出信号/不生成卖出记录）
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
