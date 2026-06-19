import { Trend3Strategy } from './trend3.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根 K 线：high/low 由 close ± hl/2 生成（控制 ATR）；ma20/ma60 控制 regime。
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

// 21 根 100 的「底座」（regime 成立：close>ma60 且 ma20>ma60），使近 20 日最高收盘 = 100
function base(): StrategyBar[] {
  const bars: StrategyBar[] = [];
  for (let i = 0; i < 21; i++) {
    bars.push(
      bar(`2026-01-${String(i + 1).padStart(2, '0')}`, 100, { chg: 0, ma20: 99, ma60: 98 }),
    );
  }
  return bars;
}

describe('Trend3Strategy（趋势跟随）', () => {
  const strategy = new Trend3Strategy();

  it('regime 成立 + 收盘创近 20 日新高 + 阳线 → 突破买入；跌破 ATR 跟踪止损 → 卖出', () => {
    const bars = [
      ...base(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 创新高(>100)、阳线 → 买入
      bar('2026-02-02', 102, { chg: 1, ma20: 100, ma60: 98.5 }),
      bar('2026-02-03', 103, { chg: 1, ma20: 100.5, ma60: 99 }), // 峰值收盘 103
      bar('2026-02-04', 97, { chg: -5.8, ma20: 101, ma60: 99.5 }), // 跌破 峰值-3×ATR → 卖出
    ];
    const startIndex = 21; // 回测从底座之后开始
    const { trades, signals } = strategy.run({ bars, testStartIndex: startIndex });

    expect(signals[21]).toBe('buy');
    expect(signals[24]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(101);
    expect(trades[0].sellPrice).toBe(97);
    expect(trades[0].forcedClose).toBeUndefined();
  });

  it('regime 不成立（MA20 <= MA60）时即使创新高也不入场', () => {
    const bars = [
      ...base(),
      // close 101 创新高、阳线，但 ma20 99 <= ma60 100（中期未转多） → 不买入
      bar('2026-02-01', 101, { chg: 1, ma20: 99, ma60: 100 }),
      bar('2026-02-02', 102, { chg: 1, ma20: 99, ma60: 100 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('未创新高（无突破）时不入场', () => {
    const bars = [
      ...base(),
      // regime 成立、阳线，但 close 99 < 近 20 日最高收盘 100（未突破） → 不买入
      bar('2026-02-01', 99, { chg: 1, ma20: 99.5, ma60: 98 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('回测结束仍持仓时末根强制平仓，不打卖出信号', () => {
    const bars = [
      ...base(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 102, { chg: 1, ma20: 100, ma60: 98.5 }),
      bar('2026-02-03', 103, { chg: 1, ma20: 100.5, ma60: 99 }), // 末根仍持仓
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBe('buy');
    expect(signals[23]).toBeNull(); // 末根不打卖出信号
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
    expect(trades[0].sellPrice).toBe(103);
  });

  it('shouldHold（中期上升趋势）与 cumulHold 计算正确', () => {
    const bars = [
      bar('2026-01-01', 100, { chg: 1, ma20: 99, ma60: 98 }), // close>ma60 且 ma20>ma60 → true
      bar('2026-01-02', 101, { chg: 1, ma20: 99, ma60: 98 }), // true
      bar('2026-01-03', 97, { chg: -1, ma20: 99, ma60: 98 }), // close 97 < ma60 98 → false
      bar('2026-01-04', 102, { chg: 1, ma20: 99, ma60: 98 }), // true
    ];
    strategy.run({ bars, testStartIndex: 0 });

    expect(bars.map((b) => b.shouldHold)).toEqual([true, true, false, true]);
    expect(bars.map((b) => b.cumulHold)).toEqual([0, 1, 2, 0]);
  });
});
