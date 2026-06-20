import { Trend6Strategy } from './trend6.strategy';
import { Trend5Strategy } from './trend5.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根 K 线：high/low 由 close ± hl/2 生成（控制 ATR）；ma20/ma60 控制 regime、趋势斜率与 MA20 离场。
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

// 21 根 100 的底座：close=100 使近 20 日最高=100、hl=1 → ATR≈1；ma20=99 维持 regime；MA60 缓升满足趋势确认。
function baseRising(): StrategyBar[] {
  const bars: StrategyBar[] = [];
  for (let i = 0; i < 21; i++) {
    bars.push(
      bar(`2026-01-${String(i + 1).padStart(2, '0')}`, 100, {
        chg: 0,
        ma20: 99,
        ma60: 96 + i * 0.1,
      }),
    );
  }
  return bars;
}

describe('Trend6Strategy（趋势确认 + 分层止损 + MA20 离场）', () => {
  const strategy = new Trend6Strategy();

  it('MA60 上行 + 突破阳线 → 入场（与 trend5 一致）', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }),
      bar('2026-02-02', 102, { chg: 1, ma20: 100, ma60: 98.2 }),
    ];
    expect(strategy.run({ bars, testStartIndex: 21 }).signals[21]).toBe('buy');
  });

  it('收盘跌破 MA20 即离场（新增卖点）——即使未触及 ATR 止损也卖出', () => {
    // 买价 101，初始止损≈99。次根收盘 99.5 仍在止损之上，但跌破 MA20(100) → trend6 卖出。
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 99.5, { chg: -1.5, ma20: 100, ma60: 98.2 }), // 99.5>止损99 但 <MA20 100
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[22]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].sellPrice).toBe(99.5);
    expect(trades[0].sellReason).toContain('MA20');

    // 对照：trend5 无 MA20 卖点，同一根不卖出（99.5 仍在止损之上）
    const t5 = new Trend5Strategy().run({ bars, testStartIndex: 21 });
    expect(t5.signals[22]).toBeNull();
  });

  it('收盘在 MA20 之上但跌破棘轮止损时，仍按原止损离场', () => {
    // ma20=98 压到止损(99)之下；次根收盘 98.5 在 MA20 之上但 < 止损99 → 走止损卖出。
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入，初始止损≈99
      bar('2026-02-02', 98.5, { chg: -2.5, ma20: 98, ma60: 98.2 }), // 98.5>MA20(98) 但 <止损99
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[22]).toBe('sell');
    expect(trades[0].sellPrice).toBe(98.5);
    expect(trades[0].sellReason).toContain('初始止损');
  });

  it('ETF 参数集随 isEtf 生效：突破回看放宽到 40', () => {
    // 前 20 根抬到 105（近 40 日高=105），后 21 根回落 100；末根 101 破近 20 日高但不破近 40 日高。
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
    bars.push(bar('2026-03-01', 101, { chg: 1, ma20: 99.5, ma60: 95 }));

    expect(strategy.run({ bars, testStartIndex: 41, isEtf: false }).signals[41]).toBe('buy');
    expect(strategy.run({ bars, testStartIndex: 41, isEtf: true }).signals[41]).toBeNull();
  });

  it('回测结束仍持仓时末根强制平仓，不打卖出信号', () => {
    // 各根收盘均在 MA20 之上、无跌破止损 → 持有到末根强制平仓。
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
