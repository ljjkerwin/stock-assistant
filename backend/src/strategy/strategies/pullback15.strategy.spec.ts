import { Pullback15Strategy } from './pullback15.strategy';
import type { StrategyBar } from './strategy.interface';

// 构造一根 K 线：仅设置策略实际消费的字段（close/changePercent/macd.dif·dea/ma20·ma60/rsi6）。
function bar(
  time: string,
  close: number,
  opts: {
    chg?: number;
    ma20: number;
    ma60: number;
    ma5?: number;
    ma10?: number;
    dif?: number;
    dea?: number;
    rsi6?: number;
  },
): StrategyBar {
  return {
    time,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 0,
    changePercent: opts.chg ?? 0,
    macd: { dif: opts.dif ?? 0, dea: opts.dea ?? 0, bar: 0 },
    ma: { ma5: opts.ma5 ?? close, ma10: opts.ma10 ?? close, ma20: opts.ma20, ma60: opts.ma60 },
    boll: { upper: null, mid: null, lower: null },
    rsi: { rsi6: opts.rsi6 ?? 50 },
    attrs: { kmacd: false, krsi: false, kma: false },
  };
}

// 17 根「底座」：close=100、ma20=99、dif=dea=0（无金叉）、rsi6=50；ma60 由 ma60At 控制斜率。
// 取 17 根是为了满足 MA60 斜率确认（ma60[i] > ma60[i-16]）所需的回看窗口。
function makeBase(ma60At: (i: number) => number): StrategyBar[] {
  const bars: StrategyBar[] = [];
  for (let i = 0; i < 17; i++) {
    bars.push(
      bar(`2026-01-05 ${String(9 + i).padStart(2, '0')}:30`, 100, { ma20: 99, ma60: ma60At(i) }),
    );
  }
  return bars;
}
// MA60 缓升 96→97.6（斜率为正，趋势确认通过）。
const baseRising = (): StrategyBar[] => makeBase((i) => 96 + i * 0.1);
// MA60 走平在 98（斜率为 0，趋势确认不通过）。
const baseFlat = (): StrategyBar[] => makeBase(() => 98);

const TEST_START = 17;

describe('Pullback15Strategy（15分钟·趋势自适应：回调金叉+强趋势骑乘）', () => {
  const strategy = new Pullback15Strategy();

  it('趋势成立 + MACD 金叉 + 阳线 + RSI 未超买 → 入场', () => {
    const bars = [
      ...baseRising(),
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }),
    ];
    const { signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBe('buy');
  });

  it('MA60 走平时即使金叉阳线也不入场（趋势确认过滤）', () => {
    const bars = [
      ...baseFlat(),
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 98, dif: 1, dea: 0, rsi6: 60 }),
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('RSI6 超买（≥75）时不入场', () => {
    const bars = [
      ...baseRising(),
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 80 }),
    ];
    const { signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBeNull();
  });

  it('无金叉（dif 未上穿 dea）时不入场', () => {
    const bars = [
      ...baseRising(),
      // dif > dea 但上一根已是 dif > dea（非穿越当根）
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0.5, rsi6: 60 }),
    ];
    // 把底座最后一根也设为 dif>dea，确保当根不构成「上穿」
    bars[TEST_START - 1] = bar(bars[TEST_START - 1].time, 100, {
      ma20: 99,
      ma60: 95.6,
      dif: 1,
      dea: 0.5,
    });
    const { signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBeNull();
  });

  it('强趋势 onset（多头排列首根铺开）+ MACD 多头 → 骑乘入场（放开 RSI、无需金叉/阳线）', () => {
    const base = baseRising();
    // 前一根：dif>dea（使当根不构成「新鲜金叉」），但 ma5=ma10 → 非 strongUp
    base[TEST_START - 1] = bar(base[TEST_START - 1].time, 100, {
      ma20: 99,
      ma60: 97.6,
      dif: 1,
      dea: 0.5,
    });
    const bars = [
      ...base,
      // strongUp 首根：MA5>MA10>MA20>MA60、close>MA20、MA60 上行；chg=0（非阳线）、RSI 超买、非金叉
      bar('2026-01-06 09:30', 101, {
        chg: 0,
        ma5: 101,
        ma10: 100.5,
        ma20: 99.5,
        ma60: 97.7,
        dif: 1,
        dea: 0.5,
        rsi6: 85,
      }),
    ];
    const { signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBe('buy');
  });

  it('强趋势已持续（前一根也 strongUp）时不重复触发骑乘入场，仅 onset 首根买入', () => {
    const strong = (time: string, close: number) =>
      bar(time, close, {
        ma5: close,
        ma10: close - 0.4,
        ma20: close - 1,
        ma60: 97.7,
        dif: 1,
        dea: 0.5,
      });
    const base = baseRising();
    base[TEST_START - 1] = bar(base[TEST_START - 1].time, 100, {
      ma20: 99,
      ma60: 97.6,
      dif: 1,
      dea: 0.5,
    });
    const bars = [
      ...base,
      strong('2026-01-06 09:30', 101), // onset → 买
      strong('2026-01-06 09:45', 102), // 仍 strongUp，但已持仓且非 onset → 不再产生 buy
    ];
    const { signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBe('buy');
    expect(signals[TEST_START + 1]).toBeNull();
  });

  it('持仓中单根跌破 MA20 不离场，连续 2 根才卖', () => {
    const bars = [
      ...baseRising(),
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }), // 买（close>ma20）
      bar('2026-01-06 09:45', 98, { chg: -2, ma20: 99, ma60: 97.8 }), // 第 1 根跌破 ma20 → 不卖
      bar('2026-01-06 10:00', 97, { chg: -1, ma20: 99, ma60: 97.9 }), // 第 2 根连续跌破 → 卖
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBe('buy');
    expect(signals[TEST_START + 1]).toBeNull();
    expect(signals[TEST_START + 2]).toBe('sell');
    expect(trades).toHaveLength(1);
    expect(trades[0].sellReason).toContain('MA20');
  });

  it('持仓中趋势破位（MA20 < MA60）→ 离场', () => {
    const bars = [
      ...baseRising(),
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }), // 买
      bar('2026-01-06 09:45', 100, { chg: 0, ma20: 96, ma60: 97 }), // ma20<ma60 趋势破位 → 卖（close 仍 > ma20）
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START + 1]).toBe('sell');
    expect(trades[0].sellReason).toContain('破位');
  });

  it('回测结束仍持仓 → 末根强制平仓，不记卖出信号/记录', () => {
    const bars = [
      ...baseRising(),
      bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }), // 买
      bar('2026-01-06 09:45', 101, { chg: 1, ma20: 99, ma60: 97.8, dif: 1, dea: 0 }), // 仍持仓
    ];
    const { trades, signals } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START + 1]).toBeNull();
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true);
  });
});

// 就地写入 service 层附加的日线趋势状态（dailyDown/dailyStrongUp/dailyUp）。
function withDaily(
  bars: StrategyBar[],
  opts: { down?: boolean; strongUp?: boolean; up?: boolean } = {},
): StrategyBar[] {
  bars.forEach((b) => {
    b.dailyDown = opts.down ?? false;
    b.dailyStrongUp = opts.strongUp ?? false;
    b.dailyUp = opts.up ?? false;
  });
  return bars;
}

describe('Pullback15Strategy · 多周期日线趋势闸（宽松口径：只挡 dailyDown）', () => {
  const strategy = new Pullback15Strategy();

  // 一个 15min 自身满足回调金叉入场的场景，复用于「闸开/闸关」对照。
  const entryBars = (): StrategyBar[] => [
    ...baseRising(),
    bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }),
  ];

  it('日线明确下行（dailyDown=true）→ 趋势闸拦截，本可入场也不发买点', () => {
    const { signals, trades } = strategy.run({
      bars: withDaily(entryBars(), { down: true }),
      testStartIndex: TEST_START,
    });
    expect(signals[TEST_START]).toBeNull();
    expect(trades).toHaveLength(0);
  });

  it('日线走平（dailyDown=false 且 dailyUp=false）→ 趋势闸放行，15min 信号照常入场', () => {
    const { signals } = strategy.run({
      bars: withDaily(entryBars(), { down: false, up: false }),
      testStartIndex: TEST_START,
    });
    expect(signals[TEST_START]).toBe('buy');
  });

  it('日线强上行（dailyStrongUp=true）→ 骑乘保护：连续 2 根跌破 MA20 的软离场被忽略，继续持有', () => {
    const bars = withDaily(
      [
        ...baseRising(),
        bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }), // 买
        bar('2026-01-06 09:45', 98, { chg: -2, ma20: 99, ma60: 97.8 }), // 跌破 MA20 第 1 根
        bar('2026-01-06 10:00', 97, { chg: -1, ma20: 99, ma60: 97.9 }), // 连续第 2 根：常态会卖，强上行保护下不卖
      ],
      { strongUp: true, up: true },
    );
    const { signals, trades } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START]).toBe('buy');
    expect(signals[TEST_START + 2]).toBeNull(); // 软离场被忽略
    expect(trades).toHaveLength(1);
    expect(trades[0].forcedClose).toBe(true); // 持有到末根强制平仓
  });

  it('日线强上行下仍保留硬离场：15min 结构破位（MA20<MA60）照常卖出', () => {
    const bars = withDaily(
      [
        ...baseRising(),
        bar('2026-01-06 09:30', 100, { chg: 1, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }), // 买
        bar('2026-01-06 09:45', 100, { chg: 0, ma20: 96, ma60: 97 }), // MA20<MA60 结构破位 → 卖
      ],
      { strongUp: true, up: true },
    );
    const { signals, trades } = strategy.run({ bars, testStartIndex: TEST_START });
    expect(signals[TEST_START + 1]).toBe('sell');
    expect(trades[0].sellReason).toContain('破位');
  });

  it('模式③加速再入场：日线强上行 + 15min 上升趋势 + MACD 多头，即使无金叉/阳线也入场；非强上行则不入', () => {
    // 该根 inUptrend 成立、dif>dea，但当根非阳线（chg=0）→ 模式①失败；非 strongUp → 模式②失败。
    const make = (): StrategyBar[] => [
      ...baseRising(),
      bar('2026-01-06 09:30', 100, { chg: 0, ma20: 99, ma60: 97.7, dif: 1, dea: 0, rsi6: 60 }),
    ];
    // 闸放行但日线非强上行（仅 up）：三模式都不满足 → 不入场
    const flat = strategy.run({
      bars: withDaily(make(), { up: true }),
      testStartIndex: TEST_START,
    });
    expect(flat.signals[TEST_START]).toBeNull();
    // 日线强上行：模式③触发买入
    const strong = strategy.run({
      bars: withDaily(make(), { strongUp: true, up: true }),
      testStartIndex: TEST_START,
    });
    expect(strong.signals[TEST_START]).toBe('buy');
    expect(strong.trades[0].buyReason).toContain('加速再入场');
  });
});
