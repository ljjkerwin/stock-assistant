import { TrendStrategy } from './trend.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根带最小必要字段的 K 线：hold 决定三属性是否全满足，up 决定当日是否上涨
function bar(time: string, close: number, hold: boolean, up: boolean): StrategyBar {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
    changePercent: up ? 1 : -1,
    macd: { dif: 0, dea: 0, bar: 0 },
    ma: { ma5: close, ma10: close, ma20: close, ma60: close },
    rsi: { rsi6: hold ? 60 : 40 },
    attrs: { kmacd: hold, krsi: hold, kma: hold },
  };
}

describe('TrendStrategy', () => {
  const strategy = new TrendStrategy();

  it('起点 shouldHold 为 true 且为阳线时立即建仓', () => {
    const bars = [
      bar('2026-01-01', 10, true, true), // testStart：立即买入
      bar('2026-01-02', 11, true, true),
      bar('2026-01-03', 12, false, false), // 卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[0]).toBe('buy');
    expect(signals[2]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(10);
    expect(trades[0].sellPrice).toBe(12);
    expect(trades[0].forcedClose).toBeUndefined();
  });

  it('shouldHold 由 false→true 且阳线时买入；由 true→false 时卖出', () => {
    const bars = [
      bar('2026-01-01', 10, false, false), // testStart：不持仓
      bar('2026-01-02', 11, true, true), // false→true 且阳线：买入
      bar('2026-01-03', 12, true, true),
      bar('2026-01-04', 9, false, false), // true→false：卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBe('buy');
    expect(signals[3]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(11);
    expect(trades[0].sellPrice).toBe(9);
  });

  it('false→true 但为阴线时不买入（K 线强度过滤）', () => {
    const bars = [
      bar('2026-01-01', 10, false, false),
      bar('2026-01-02', 11, true, false), // false→true 但阴线：跳过
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[1]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('回测结束仍持仓时末根强制平仓，不打卖出信号', () => {
    const bars = [
      bar('2026-01-01', 10, true, true), // 立即买入
      bar('2026-01-02', 11, true, true),
      bar('2026-01-03', 12, true, true), // 末根仍持仓
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 0 });

    expect(signals[0]).toBe('buy');
    expect(signals[2]).toBeNull(); // 末根不打卖出信号
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
    expect(trades[0].sellPrice).toBe(12);
  });

  it('计算 shouldHold 与 cumulHold', () => {
    const bars = [
      bar('2026-01-01', 10, true, true),
      bar('2026-01-02', 11, true, true),
      bar('2026-01-03', 12, false, false),
      bar('2026-01-04', 13, true, true),
    ];
    strategy.run({ bars, testStartIndex: 0 });

    expect(bars.map((b) => b.shouldHold)).toEqual([true, true, false, true]);
    // cumulHold[i] = shouldHold[i-1] ? cumulHold[i-1]+1 : 0，首根为 0
    expect(bars.map((b) => b.cumulHold)).toEqual([0, 1, 2, 0]);
  });
});
