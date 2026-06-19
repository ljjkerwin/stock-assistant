import { Trend4Strategy } from './trend4.strategy';
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

// 21 根 100 的「底座」（regime 成立），使近 20 日最高收盘 = 100；hl=1 → ATR≈1。
function base(): StrategyBar[] {
  const bars: StrategyBar[] = [];
  for (let i = 0; i < 21; i++) {
    bars.push(
      bar(`2026-01-${String(i + 1).padStart(2, '0')}`, 100, { chg: 0, ma20: 99, ma60: 98 }),
    );
  }
  return bars;
}

describe('Trend4Strategy（趋势跟随 + 分层止损）', () => {
  const strategy = new Trend4Strategy();

  it('入场后小幅回落即触发初始止损（买价 − 2×ATR）', () => {
    // ATR≈1（hl=1）。买价 101，初始止损≈101-2=99；浮盈未达 1×ATR，保本/跟踪都不抬升。
    const bars = [
      ...base(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 突破阳线 → 买入
      bar('2026-02-02', 101.2, { chg: 0.2, ma20: 100, ma60: 98.5 }), // 浮盈 0.2 < 1×ATR
      bar('2026-02-03', 98, { chg: -3.2, ma20: 100, ma60: 99 }), // 98 < 初始止损99 → 卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[21]).toBe('buy');
    expect(signals[23]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].buyPrice).toBe(101);
    expect(trades[0].sellPrice).toBe(98);
    expect(trades[0].sellReason).toContain('初始止损');
  });

  it('浮盈达 1×ATR 后回落到买价下方触发保本止损（而非吃满初始止损）', () => {
    // 买价 101；涨到 102.5（浮盈 1.5≥1×ATR）→ 止损上移到 101；随后 close 100.5<101 → 保本卖出。
    const bars = [
      ...base(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 102.5, { chg: 1.5, ma20: 100, ma60: 98.5 }), // 浮盈达标，保本位=101
      bar('2026-02-03', 100.5, { chg: -2, ma20: 100, ma60: 99 }), // 100.5<101 → 保本卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[23]).toBe('sell');
    expect(trades[0].sellPrice).toBe(100.5);
    expect(trades[0].sellReason).toContain('保本止损');
  });

  it('强趋势中由 ATR 跟踪止损离场（峰值收盘 − 3×ATR）', () => {
    const bars = [
      ...base(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99.5, ma60: 98 }), // 买入
      bar('2026-02-02', 104, { chg: 3, ma20: 100, ma60: 98.5 }),
      bar('2026-02-03', 107, { chg: 3, ma20: 101, ma60: 99 }), // 峰值收盘 107，跟踪位≈107-3×ATR≈102.9
      bar('2026-02-04', 100, { chg: -6.5, ma20: 102, ma60: 99.5 }), // 100<跟踪位 → 跟踪卖出
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: 21 });

    expect(signals[24]).toBe('sell');
    expect(trades[0].sellPrice).toBe(100);
    expect(trades[0].sellReason).toContain('跟踪止损');
  });

  it('入场逻辑与 trend3 一致：regime 不成立时即使创新高也不入场', () => {
    const bars = [
      ...base(),
      bar('2026-02-01', 101, { chg: 1, ma20: 99, ma60: 100 }), // ma20<=ma60 → 不买
      bar('2026-02-02', 102, { chg: 1, ma20: 99, ma60: 100 }),
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
    expect(signals[23]).toBeNull();
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
    expect(trades[0].sellPrice).toBe(103);
  });
});
