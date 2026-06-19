import { Trend2Strategy } from './trend2.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根带 v2 入场所需字段的 K 线。ext = close/ma20，slope 由相邻两根 ma20 决定。
function bar(
  time: string,
  close: number,
  opts: {
    ma5: number;
    ma10: number;
    ma20: number;
    dif: number;
    dea: number;
    chg: number;
    rsi?: number;
    ma60?: number;
  },
): StrategyBar {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
    changePercent: opts.chg,
    macd: { dif: opts.dif, dea: opts.dea, bar: opts.dif - opts.dea },
    // ma60 默认取 ma10，使 TAR=MA20/MA60 落在正常区间；需测 TAR 门槛时显式传入 ma60。
    ma: { ma5: opts.ma5, ma10: opts.ma10, ma20: opts.ma20, ma60: opts.ma60 ?? opts.ma10 },
    rsi: { rsi6: opts.rsi ?? 50 },
    attrs: { kmacd: false, krsi: false, kma: false },
  };
}

describe('Trend2Strategy（自适应双模式）', () => {
  const strategy = new Trend2Strategy();

  it('趋势模式：多头排列 + 零轴上方走强 + 通过强趋势闸门 → 买入，跌破 MA10 卖出', () => {
    const bars = [
      bar('2026-01-01', 105, { ma5: 104, ma10: 102, ma20: 100, dif: 1.0, dea: 0.9, chg: -1 }),
      // ma5>ma10>ma20、close>ma10、MA10拐头、阳线、dif>dea且回升、dif>0、
      // ext=110/101=1.089≥1.06、slope=(101/100-1)*100=1.0%≥0.6 → 趋势买入
      bar('2026-01-02', 110, { ma5: 106, ma10: 103, ma20: 101, dif: 1.2, dea: 1.0, chg: 2 }),
      bar('2026-01-03', 112, { ma5: 108, ma10: 105, ma20: 102, dif: 1.3, dea: 1.1, chg: 1 }),
      // 跌破 MA10（close 100 < ma10 106） → 趋势模式卖出
      bar('2026-01-04', 100, { ma5: 109, ma10: 106, ma20: 103, dif: 1.2, dea: 1.2, chg: -10 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBe('buy');
    expect(signals[3]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(110);
    expect(trades[0].sellPrice).toBe(100);
    expect(trades[0].sellReason).toContain('MA10');
  });

  it('反弹模式：零轴下方金叉 + 站上 MA10/MA20 + 非超买 → 买入，跌破 MA5 卖出', () => {
    const bars = [
      bar('2026-01-01', 10, { ma5: 10.0, ma10: 9.8, ma20: 9.5, dif: -0.5, dea: -0.4, chg: -1 }),
      // dif<0 金叉回升、close>ma10/ma20、ma5>ma10、MA10拐头、阳线、rsi60∈[55,70) → 反弹买入
      bar('2026-01-02', 11, {
        ma5: 10.6,
        ma10: 9.9,
        ma20: 9.6,
        dif: -0.3,
        dea: -0.4,
        chg: 2,
        rsi: 60,
      }),
      bar('2026-01-03', 12, { ma5: 11.2, ma10: 10.5, ma20: 9.8, dif: -0.1, dea: -0.3, chg: 1.5 }),
      // 跌破 MA5（close 11 < ma5 11.5） → 反弹模式卖出（注意 close 11 仍 > ma10 11，不会误判趋势出场）
      bar('2026-01-04', 11, { ma5: 11.5, ma10: 11.0, ma20: 10.0, dif: -0.2, dea: -0.2, chg: -1 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBe('buy');
    expect(signals[3]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(11);
    expect(trades[0].sellReason).toContain('MA5');
  });

  it('反弹模式：RSI6 低于下限（弱势死猫跳）时不入场', () => {
    const bars = [
      bar('2026-01-01', 10, { ma5: 10.0, ma10: 9.8, ma20: 9.5, dif: -0.5, dea: -0.4, chg: -1 }),
      // 反弹其余条件满足，但 rsi6=50 < 55（力度不足） → 不买入
      bar('2026-01-02', 11, {
        ma5: 10.6,
        ma10: 9.9,
        ma20: 9.6,
        dif: -0.3,
        dea: -0.4,
        chg: 2,
        rsi: 50,
      }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('多头排列 + 零轴上方但未过强趋势闸门（乖离不足）时不入场（行情识别过滤）', () => {
    const bars = [
      bar('2026-01-01', 105, { ma5: 104, ma10: 102, ma20: 101.5, dif: 1.0, dea: 0.9, chg: -1 }),
      // 趋势其余条件满足，但 ext=103/102=1.0098 < 1.06（乖离不足）→ 趋势拒绝；
      // 且 dif>0 → 反弹也拒绝（反弹要求 dif<0） → 不入场
      bar('2026-01-02', 103, { ma5: 103.5, ma10: 102.5, ma20: 102, dif: 1.1, dea: 1.0, chg: 1 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('趋势模式：TAR=MA20/MA60 过热（>1.10）时不入场', () => {
    const bars = [
      bar('2026-01-01', 105, {
        ma5: 104,
        ma10: 102,
        ma20: 100,
        ma60: 92,
        dif: 1.0,
        dea: 0.9,
        chg: -1,
      }),
      // 趋势其余条件满足，但 TAR=101/90=1.122 > 1.10（过热） → 不买入
      bar('2026-01-02', 110, {
        ma5: 106,
        ma10: 103,
        ma20: 101,
        ma60: 90,
        dif: 1.2,
        dea: 1.0,
        chg: 2,
      }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('反弹模式：TAR=MA20/MA60 过低（<0.90，深跌）时不入场', () => {
    const bars = [
      bar('2026-01-01', 10, {
        ma5: 10.0,
        ma10: 9.8,
        ma20: 9.5,
        ma60: 11,
        dif: -0.5,
        dea: -0.4,
        chg: -1,
      }),
      // 反弹其余条件满足，但 TAR=9.6/11=0.873 < 0.90（深跌） → 不买入
      bar('2026-01-02', 11, {
        ma5: 10.6,
        ma10: 9.9,
        ma20: 9.6,
        ma60: 11,
        dif: -0.3,
        dea: -0.4,
        chg: 2,
        rsi: 60,
      }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('入场为阴线时不买入（两模式共用的 K 线强度过滤）', () => {
    const bars = [
      bar('2026-01-01', 10, { ma5: 10.0, ma10: 9.8, ma20: 9.5, dif: -0.5, dea: -0.4, chg: -1 }),
      // 反弹其余条件满足但当日下跌（chg=-1） → 跳过
      bar('2026-01-02', 11, { ma5: 10.6, ma10: 9.9, ma20: 9.6, dif: -0.3, dea: -0.4, chg: -1 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('回测结束仍持仓时末根强制平仓，不打卖出信号', () => {
    const bars = [
      bar('2026-01-01', 105, { ma5: 104, ma10: 102, ma20: 100, dif: 1.0, dea: 0.9, chg: -1 }),
      bar('2026-01-02', 110, { ma5: 106, ma10: 103, ma20: 101, dif: 1.2, dea: 1.0, chg: 2 }), // 趋势买入
      bar('2026-01-03', 112, { ma5: 108, ma10: 105, ma20: 102, dif: 1.3, dea: 1.1, chg: 1 }), // 末根仍持仓
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBe('buy');
    expect(signals[2]).toBeNull(); // 末根不打卖出信号
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
    expect(trades[0].sellPrice).toBe(112);
  });

  it('shouldHold（趋势向上状态）与 cumulHold 计算正确', () => {
    const bars = [
      bar('2026-01-01', 11, { ma5: 10.6, ma10: 10.4, ma20: 10.0, dif: 0, dea: 0, chg: 1 }), // close>ma10&ma5>ma10
      bar('2026-01-02', 12, { ma5: 11.2, ma10: 10.8, ma20: 10.2, dif: 0, dea: 0, chg: 1 }), // hold
      bar('2026-01-03', 10, { ma5: 11.0, ma10: 11.0, ma20: 10.4, dif: 0, dea: 0, chg: -1 }), // close<ma10 → false
      bar('2026-01-04', 13, { ma5: 12.0, ma10: 11.5, ma20: 10.6, dif: 0, dea: 0, chg: 1 }), // hold
    ];
    strategy.run({ bars, testStartIndex: 0 });

    expect(bars.map((b) => b.shouldHold)).toEqual([true, true, false, true]);
    expect(bars.map((b) => b.cumulHold)).toEqual([0, 1, 2, 0]);
  });
});
