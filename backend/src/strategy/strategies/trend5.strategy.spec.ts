import { Trend5Strategy } from './trend5.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根 K 线：high/low 由 close ± hl/2 生成（控制 ATR）；ma20/ma60 控制 regime 与趋势斜率。
function bar(
  time: string,
  close: number,
  opts: { chg: number; ma20: number; ma60: number; hl?: number },
): StrategyBar {
  const hl = opts.hl ?? 1;
  return {
    time,
    open: close,
    high: close + hl / 2,
    low: close - hl / 2,
    close,
    volume: 0,
    changePercent: opts.chg,
    macd: { dif: 0, dea: 0, bar: 0 },
    ma: { ma5: close, ma10: close, ma20: opts.ma20, ma60: opts.ma60 },
    rsi: { rsi6: 50 },
    attrs: { kmacd: false, krsi: false, kma: false },
  };
}

// 21 根 100 的「底座」：close=100 使近 20 日最高收盘=100、hl=1 → ATR≈1；ma20=99 维持 regime。
// ma60 由 ma60At(i) 控制——trend5 入场要求 MA60 自身上行（ma60[i] > ma60[i-10]）。
function makeBase(ma60At: (i: number) => number): StrategyBar[] {
  const bars: StrategyBar[] = [];
  for (let i = 0; i < 21; i++) {
    bars.push(
      bar(`2026-01-${String(i + 1).padStart(2, '0')}`, 100, { chg: 0, ma20: 99, ma60: ma60At(i) }),
    );
  }
  return bars;
}
// MA60 缓升 96→98（斜率为正，满足趋势确认）。
const baseRising = (): StrategyBar[] => makeBase((i) => 96 + i * 0.1);
// MA60 走平在 98（斜率为 0，趋势确认不通过）。
const baseFlat = (): StrategyBar[] => makeBase(() => 98);

describe('Trend5Strategy（趋势跟随 + 分层止损 + 趋势确认）', () => {
  const strategy = new Trend5Strategy();

  it('MA60 走平时即使突破阳线也不入场（趋势确认过滤，trend5 新增）', () => {
    const bars = [
      ...baseFlat(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 突破阳线但 ma60[11]=98 不小于 98
      bar('2026-02-02', 102, { chg: 1, ma20: 100, ma60: 98 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('MA60 上行 + 突破阳线 → 入场', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // ma60[11]=97.1 < 98 → 上行
      bar('2026-02-02', 102, { chg: 1, ma20: 100, ma60: 98.2 }),
    ];
    const { signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBe('buy');
  });

  it('入场后小幅回落即触发初始止损（买价 − 2×ATR，初始止损保持紧）', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 突破阳线 → 买入
      bar('2026-02-02', 101.2, { chg: 0.2, ma20: 100, ma60: 98.2 }), // 浮盈 0.2 < 1×ATR
      bar('2026-02-03', 98, { chg: -3.2, ma20: 100, ma60: 98.4 }), // 98 < 初始止损99 → 卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBe('buy');
    expect(signals[23]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(101);
    expect(trades[0].sellPrice).toBe(98);
    expect(trades[0].sellReason).toContain('初始止损');
  });

  it('浮盈达 1×ATR 后回落到买价下方触发保本止损（保本位保持早）', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 102.5, { chg: 1.5, ma20: 100, ma60: 98.2 }), // 浮盈达标，保本位=101
      bar('2026-02-03', 100.5, { chg: -2, ma20: 100, ma60: 98.4 }), // 100.5<101 → 保本卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[23]).toBe('sell');
    expect(trades[0].sellPrice).toBe(100.5);
    expect(trades[0].sellReason).toContain('保本止损');
  });

  it('强趋势中由 ATR 跟踪止损离场（峰值收盘 − 3.5×ATR，放宽后让盈利单跑更久）', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 104, { chg: 3, ma20: 100, ma60: 98.2 }),
      bar('2026-02-03', 107, { chg: 3, ma20: 101, ma60: 98.4 }), // 峰值收盘 107，跟踪位≈107-3.5×ATR≈103.5
      bar('2026-02-04', 100, { chg: -6.5, ma20: 102, ma60: 98.6 }), // 100<跟踪位 → 跟踪卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[24]).toBe('sell');
    expect(trades[0].sellPrice).toBe(100);
    expect(trades[0].sellReason).toContain('跟踪止损');
  });

  it('regime 不成立时（ma20<=ma60）即使创新高也不入场', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99, ma60: 100 }), // ma20<=ma60 → 不买
      bar('2026-02-02', 102, { chg: 1, ma20: 99, ma60: 100 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('ETF 参数集：突破回看放宽到 40，创近 20 日新高但非 40 日新高时不入场', () => {
    // 构造 41 根底座：前 20 根抬高到 105（成为近 40 日高点），后 21 根回落到 100。
    // 这样在末根之后「近 20 日最高=100」会被突破，但「近 40 日最高=105」不会 → ETF 不入场、个股入场。
    const bars: StrategyBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(
        bar(`2026-01-${String(i + 1).padStart(2, '0')}`, 105, {
          chg: 0,
          ma20: 99,
          ma60: 90 + i * 0.1,
        }),
      );
    }
    for (let i = 20; i < 41; i++) {
      bars.push(
        bar(`2026-02-${String(i - 19).padStart(2, '0')}`, 100, {
          chg: 0,
          ma20: 99,
          ma60: 90 + i * 0.1,
        }),
      );
    }
    // 突破阳线：收盘 101 > 近 20 日高(100) 但 < 近 40 日高(105)；ma20>ma60 且 MA60 上行
    bars.push(bar('2026-03-01', 101, { chg: 1, ma20: 99.5, ma60: 95 }));

    const stock = strategy.run({ bars, testStartIndex: 41, isEtf: false });
    const etf = strategy.run({ bars, testStartIndex: 41, isEtf: true });

    expect(stock.signals[41]).toBe('buy'); // 个股 20 日突破成立
    expect(etf.signals[41]).toBeNull(); // ETF 需 40 日突破，不入场
  });

  it('回测结束仍持仓时末根强制平仓，不打卖出信号', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 102, { chg: 1, ma20: 100, ma60: 98.2 }),
      bar('2026-02-03', 103, { chg: 1, ma20: 100.5, ma60: 98.4 }), // 末根仍持仓
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBe('buy');
    expect(signals[23]).toBeNull();
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
    expect(trades[0].sellPrice).toBe(103);
  });
});
