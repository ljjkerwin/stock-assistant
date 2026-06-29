import type { Strategy, StrategyContext, StrategyRunResult, Trade } from './strategy.interface';

/**
 * 15 分钟·趋势自适应（回调金叉 + 强趋势骑乘）。
 *
 * 面向 15min K 线的多周期趋势策略，帮助判断 A 股标的的短波段买卖点。
 * 核心思路（按用户「针对不同趋势用不同策略」的要求做 regime 自适应）：用「慢周期代理」
 * （15min 上的 MA60 ≈ 近 4 个交易日中枢）定方向，只在中期上升趋势中做多，并按**趋势强弱
 * 切换两种入场**——
 *
 * - **趋势过滤（regime，复用 trend5 口径）**：`close>MA60 && MA20>MA60 && MA60 上行`
 *   （`ma60[i] > ma60[i − MA60_SLOPE_LOOKBACK]`），下跌/走平市整段空仓。
 *
 * - **多周期日线趋势闸（MTF，service 层附加 `dailyUp`/`dailyStrongUp`）**：在 15min 自身 regime
 *   之上再叠一层「日线定方向」——「日线定方向、日内定点位」。两项均用**上一交易日收盘**的日线
 *   状态（防未来函数，对齐逻辑见 {@link ../strategy.service.ts}）：
 *   1. **趋势闸（宽松口径）**：只在日线**明确下行**（`dailyDown`，即日线 `MA20<MA60`）时一律不发
 *      买点，**放行走平/上行 regime**——既挡住日线阴跌中的 15min 反复抄底挨打（那批阴跌 ETF 的主要
 *      失血来源），又保留震荡/筑底（走平）段的反弹机会。（更严的「必须 `dailyUp` 才放行」口径会把
 *      走平段一并空仓，实测在偏熊窗口更稳但牺牲机会，故采用宽松口径作默认。）
 *   2. **强上行骑乘保护**：日线处于强趋势（`dailyStrongUp`）时，把 15min「连续 2 根收盘跌破 MA20」
 *      的软离场视为趋势内噪声而**忽略**，仅保留 15min 结构破位（`MA20<MA60`）的硬离场——直接修复
 *      日线大单边上行里 15min 频繁进出磨损的标的（如中富电路日线 +111%、深天马 +25% 却被 15min
 *      churn 成负收益）。
 *   日内周期回测时由 service 附加；daily 周期或日线数据缺失时整列为 undefined，本策略自动回退为
 *   纯 15min 单周期行为（向后兼容，原有单测不受影响）。
 *
 * - **入场（两种模式，取先满足）**：
 *   1. **回调金叉（普通上升趋势）**：regime 成立 + MACD 金叉（`dif` 上穿 `dea`）+ 当日阳线
 *      + RSI6 未超买（`< RSI_OVERBOUGHT`）。捕捉趋势内回调结束的买点；RSI 上限用于在**震荡/普通
 *      趋势**里避免追高接最后一棒。**不要求 `dif>0`**——regime 已保证方向，零轴下方的较深
 *      回调金叉恰是好买点。
 *   2. **强趋势骑乘（强趋势）**：在多头排列充分铺开（`MA5>MA10>MA20>MA60` 且 MA60 上行
 *      且 `close>MA20`，即 {@link isStrongUp}）**刚刚成立的那一刻**（strongUp 由假转真），
 *      只要 **MACD 多头（`dif>dea`）** 即入场，**不设 RSI 上限、不要求新鲜金叉、不要求当根阳线**。
 *      —— 这是针对原策略最大失血点的修复：强趋势单边上行时 MACD 一路 `dif>dea` 不再产生
 *      「新鲜金叉」、且 RSI6 长期 80+ 被超买上限挡死，于是整段主升浪一笔都进不去（实测
 *      600498 烽火通信 +64% 区间，6 月那段 +34% 拉升的每个金叉都因 RSI6≈82~84 被否决）。
 *      在强趋势里高 RSI 是动量信号而非警告，故此模式放开 RSI。**只在 strongUp 成立的第一根
 *      入场（onset），而非强趋势期间每根都进**——这是从结构上压制震荡市 churn 的关键：若改为
 *      「strongUp 期间每根阳线都入」，会在震荡市被「入场→2 根破 MA20 离场→下一根又追进」反复
 *      千刀万剐（实测震荡段收益中位 0.00→−0.57）；改为 onset 后，被洗出需待趋势重新走强（strongUp
 *      重新由假转真）才再入场，既保住震荡段保护（中位回到 0.00）又能在主升浪里再入场吃趋势。
 *      该 onset 判定为**纯结构条件、无任何拟合阈值**，在 15min 仅 50 天数据窗口内更抗过拟合。
 *
 * - **离场（趋势持有，确认破位才卖，取先触发）**：①**连续 2 根 15min 收盘跌破 MA20**
 *   （过滤单根噪声，穿越趋势的小回调不离场）；②**趋势破位** `MA20 < MA60`（中期结构走坏）。
 *   注意 {@link isStrongUp} 要求 `close>MA20`，故强趋势持有期不会触发跌破 MA20 离场；一旦
 *   趋势转弱跌回 MA20 下方满 2 根才走，若随后趋势重新走强会由强趋势骑乘模式再次入场——
 *   「先出后再进」天然避免在主升浪里被单根噪声反复踹下车。
 *   （早期版本用对称的「MACD 死叉 或 单根跌破 MA20」离场，在 15min 上过敏、盈利单被反复洗出，已弃用。）
 *
 * 历史实验留痕：曾试过「收盘创近 N 根新高突破」并行入场，10 标的篮子实测仅救活个别标的、
 * 收益中位反而下降（突破在震荡/见顶市接大量假信号、磨掉下跌保护），故未采用；本版改用
 * 「**仅在强趋势 regime 内**放开入场」的做法，把动量续入限制在多头排列充分的强趋势中，
 * 避免污染震荡/见顶市的下跌保护。
 *
 * ⚠️ 数据窗口：15min 分钟线上游最多 ~800 根 ≈ 最近 50 个交易日且不可回溯，故本策略只能在该
 * 窗口内回测、无法做多区间样本外验证；为压制过拟合，**全部判定均为相对量**（均线大小关系/
 * 斜率、MACD 穿越/方向、RSI、单根涨跌），无随股价高低失真的绝对阈值，且只设 2 个参数、不精调。
 *
 * `shouldHold`（= 中期上升趋势状态 `close>MA60 && MA20>MA60`）/`cumulHold`、末根强制平仓
 * 与其他趋势策略一致。MACD/MA/RSI/changePercent 均由接口层提供，本策略只读消费、不重算。
 */

/** MA60 斜率确认回看根数（≈1 个交易日，15min 16 根/日）。 */
const MA60_SLOPE_LOOKBACK = 16;
/** RSI6 超买阈值：**仅回调金叉模式**入场要求 `rsi6 < 此值`，避免普通趋势/震荡里追高。 */
const RSI_OVERBOUGHT = 75;

export class Pullback15Strategy implements Strategy {
  readonly id = 'pullback15';
  readonly name = '15分钟·趋势自适应（回调金叉+强趋势骑乘）';

  run({ bars, testStartIndex }: StrategyContext): StrategyRunResult {
    const n = bars.length;
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(n).fill(null) as Array<string | null>;

    // shouldHold：中期上升趋势状态（close > MA60 且 MA20 > MA60）
    for (let i = 0; i < n; i++) {
      const { ma20, ma60 } = bars[i].ma;
      bars[i].shouldHold = ma20 != null && ma60 != null && bars[i].close > ma60 && ma20 > ma60;
    }
    for (let i = 0; i < n; i++) {
      bars[i].cumulHold = i > 0 && bars[i - 1].shouldHold ? (bars[i - 1].cumulHold ?? 0) + 1 : 0;
    }

    // MA60 自身上行（趋势确认）
    const ma60Rising = (i: number): boolean => {
      const ma60 = bars[i].ma.ma60;
      const ma60Prev = i >= MA60_SLOPE_LOOKBACK ? bars[i - MA60_SLOPE_LOOKBACK].ma.ma60 : null;
      return ma60 != null && ma60Prev != null && ma60 > ma60Prev;
    };

    // 趋势过滤：普通上升趋势 regime（中期上升趋势 + MA60 上行）
    const inUptrend = (i: number): boolean => {
      const { ma20, ma60 } = bars[i].ma;
      if (ma20 == null || ma60 == null) return false;
      return ma60Rising(i) && bars[i].close > ma60 && ma20 > ma60;
    };

    // 强趋势：多头排列充分铺开（MA5>MA10>MA20>MA60 + MA60 上行 + 站上 MA20）
    const isStrongUp = (i: number): boolean => {
      const { ma5, ma10, ma20, ma60 } = bars[i].ma;
      if (ma5 == null || ma10 == null || ma20 == null || ma60 == null) return false;
      return ma5 > ma10 && ma10 > ma20 && ma20 > ma60 && ma60Rising(i) && bars[i].close > ma20;
    };

    const isUp = (i: number): boolean => bars[i].changePercent != null && bars[i].changePercent > 0;

    // ── 多周期日线趋势闸（service 层附加，daily 周期/缺失时整列为 undefined → 自动回退单周期行为）──
    // dailyUp/dailyStrongUp/dailyDown 用「上一交易日收盘」的日线状态（防未来函数，见 strategy.service.ts）。
    const dailyAttached = bars.some((b) => b.dailyDown !== undefined);
    // 趋势闸（宽松口径）：只在日线**明确下行**（MA20<MA60）时不发买点，**放行走平/上行 regime**——
    // 既挡住日线阴跌中的 15min 抄底，又保留震荡/筑底（走平）段的机会；未附加日线时不设闸。
    const dailyGateOk = (i: number): boolean => !dailyAttached || bars[i].dailyDown !== true;
    // 骑乘保护：日线处于强趋势时，把 15min 单纯跌破 MA20 的软离场视为趋势内噪声而忽略。
    const dailyStrongRide = (i: number): boolean => dailyAttached && bars[i].dailyStrongUp === true;

    // 入场模式 1：回调金叉（普通趋势，带 RSI 上限）
    const isPullbackEntry = (i: number): boolean => {
      if (!inUptrend(i)) return false;
      const { dif, dea } = bars[i].macd;
      const prev = bars[i - 1].macd;
      const goldenCross = dif > dea && prev.dif <= prev.dea;
      const rsi6 = bars[i].rsi.rsi6;
      return goldenCross && isUp(i) && rsi6 != null && rsi6 < RSI_OVERBOUGHT;
    };

    // 入场模式 2：强趋势骑乘（仅在 strongUp 由假转真的「onset」入场，MACD 多头确认；
    // 不设 RSI 上限、不要求新鲜金叉/阳线）。onset-only 从结构上避免震荡市的反复追进 churn。
    const isRideEntry = (i: number): boolean => {
      if (!isStrongUp(i) || isStrongUp(i - 1)) return false;
      const { dif, dea } = bars[i].macd;
      return dif > dea;
    };

    const PULLBACK_REASON =
      '中期上升趋势中（close>MA60、MA20>MA60 且 MA60 上行）MACD 金叉 + 阳线，回调结束入场';
    const RIDE_REASON =
      '强趋势骑乘：多头排列充分铺开（MA5>MA10>MA20>MA60、MA60 上行）成立首根 + MACD 多头，入场吃趋势';

    let position = false;
    let buyTime = '';
    let buyPrice = 0;
    let buyReason = '';

    for (let i = Math.max(1, testStartIndex); i < n; i++) {
      const bar = bars[i];
      if (!position) {
        const ride = isRideEntry(i);
        if ((ride || isPullbackEntry(i)) && dailyGateOk(i)) {
          position = true;
          buyTime = bar.time;
          buyPrice = bar.close;
          buyReason = ride ? RIDE_REASON : PULLBACK_REASON;
          signals[i] = 'buy';
        }
      } else {
        const { ma20, ma60 } = bar.ma;
        const prevMa20 = bars[i - 1].ma.ma20;
        // 连续 2 根收盘跌破 MA20：过滤单根噪声，穿越趋势的小回调不离场
        const belowMa20Confirmed =
          ma20 != null && bar.close < ma20 && prevMa20 != null && bars[i - 1].close < prevMa20;
        // 趋势破位：中期结构走坏（MA20 跌回 MA60 下方）
        const regimeBreak = ma20 != null && ma60 != null && ma20 < ma60;
        // 日线强上行骑乘保护：日线强趋势时忽略软离场（15min 跌破 MA20 视为趋势内噪声），
        // 仅保留 15min 结构破位（MA20<MA60）这一硬离场，避免主升浪里被日内回踩反复洗下车。
        const softExit = belowMa20Confirmed && !dailyStrongRide(i);
        if (softExit || regimeBreak) {
          position = false;
          trades.push({
            buyTime,
            buyPrice,
            buyReason,
            sellTime: bar.time,
            sellPrice: bar.close,
            sellReason: regimeBreak ? '趋势破位（MA20 跌破 MA60）' : '连续 2 根收盘跌破 MA20',
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
