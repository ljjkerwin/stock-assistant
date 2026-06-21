import { Trend8Strategy } from './trend8.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根 K 线。默认 high/low = close ± 0.5、open = close；ma5=ma10=close、dif>dea>0（便于满足入场 MACD 条件）。
function bar(
  time: string,
  close: number,
  opts: {
    chg: number;
    ma20: number;
    ma60: number;
    ma5?: number;
    ma10?: number;
    high?: number;
    low?: number;
    open?: number;
    dif?: number;
    dea?: number;
  },
): StrategyBar {
  return {
    time,
    open: opts.open ?? close,
    high: opts.high ?? close + 0.5,
    low: opts.low ?? close - 0.5,
    close,
    volume: 0,
    changePercent: opts.chg,
    macd: { dif: opts.dif ?? 1, dea: opts.dea ?? 0, bar: 0 },
    ma: { ma5: opts.ma5 ?? close, ma10: opts.ma10 ?? close, ma20: opts.ma20, ma60: opts.ma60 },
    rsi: { rsi6: 50 },
    attrs: { kmacd: false, krsi: false, kma: false },
  };
}

// 21 根 100 底座：chg=0（非阳线 → 不入场）、ma20=99 维持 regime、MA60 缓升满足趋势确认。
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

// 满足入场的标准建仓根：close=101、阳线、多头排列站上 MA5、MACD 多头。
function entryBar(): StrategyBar {
  return bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98, ma5: 100.5, ma10: 100 });
}

describe('Trend8Strategy（抛物线趋势骑乘 + 自适应 Parabolic SAR 离场）', () => {
  const strategy = new Trend8Strategy();

  it('趋势骨向上 + 多头排列站上 MA5 + MACD 多头 + 阳线 → 入场', () => {
    const bars = [...baseRising(), entryBar()];
    expect(strategy.run({ bars, testStartIndex: 21 }).signals[21]).toBe('buy');
  });

  it('缺少 MACD 多头（dif<dea）则不入场', () => {
    const bars = [
      ...baseRising(),
      bar('2026-02-01', 101, {
        chg: 1,
        ma20: 99.5,
        ma60: 98,
        ma5: 100.5,
        ma10: 100,
        dif: -1,
        dea: 0,
      }),
    ];
    expect(strategy.run({ bars, testStartIndex: 21 }).signals[21]).toBeNull();
  });

  it('收盘跌破 Parabolic SAR → 跟踪止损离场', () => {
    const bars = [
      ...baseRising(),
      entryBar(), // idx21 买入
      bar('2026-02-02', 105, { chg: 3.96, ma20: 100, ma60: 98.2, high: 105.5, low: 104 }), // 上行，SAR 上移但未破
      bar('2026-02-03', 98, { chg: -6.67, ma20: 101, ma60: 98.4, open: 104, high: 104, low: 97 }), // 跌破 SAR
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });
    expect(signals[23]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].sellPrice).toBe(98);
    expect(trades[0].sellReason).toContain('Parabolic SAR');
  });

  it('抛物线过热（峰值远离 MA20）后单日暴力大阴线 → 高潮反转日当日离场', () => {
    const bars = [
      ...baseRising(),
      entryBar(), // idx21 买入 101
      bar('2026-02-02', 120, { chg: 18.8, ma20: 102, ma60: 98.2, high: 121, low: 118 }),
      bar('2026-02-03', 140, { chg: 16.7, ma20: 108, ma60: 98.4, high: 141, low: 138 }),
      bar('2026-02-04', 160, { chg: 14.3, ma20: 115, ma60: 98.6, high: 161, low: 158 }),
      bar('2026-02-05', 148.8, {
        chg: -7.0,
        ma20: 120,
        ma60: 98.8,
        open: 160,
        high: 160,
        low: 147,
      }), // 高潮反转
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });
    expect(signals[25]).toBe('sell');
    expect(trades[trades.length - 1].sellReason).toContain('高潮反转');
    expect(trades[trades.length - 1].sellPrice).toBe(148.8);
  });

  it('单日大阴线但未过热（峰值贴近 MA20）→ 不判高潮反转，按 SAR 离场', () => {
    const bars = [
      ...baseRising(),
      entryBar(), // idx21 买入 101，峰值≈101.5
      bar('2026-02-02', 93.93, { chg: -7.0, ma20: 100, ma60: 98.2, open: 101, high: 101, low: 93 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });
    expect(signals[22]).toBe('sell');
    expect(trades[0].sellReason).toContain('Parabolic SAR');
    expect(trades[0].sellReason).not.toContain('高潮反转');
  });

  it('回测结束仍持仓时末根强制平仓，不打卖出信号', () => {
    const bars = [
      ...baseRising(),
      entryBar(), // idx21 买入
      bar('2026-02-02', 102, { chg: 0.99, ma20: 100, ma60: 98.2 }),
      bar('2026-02-03', 103, { chg: 0.98, ma20: 100.5, ma60: 98.4 }), // 末根仍持仓
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });
    expect(signals[21]).toBe('buy');
    expect(signals[23]).toBeNull();
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
    expect(trades[0].sellPrice).toBe(103);
  });
});
