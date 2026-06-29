import type { KlineBar } from '../../kline/kline.service';

/**
 * 策略抽象层。
 *
 * 约定：
 * - 「股票指标」（macd / ma / rsi / attrs）由接口层 KlineService 计算并随每根 K 线返回，
 *   策略层只读消费，不重算。
 * - 「策略信息」（shouldHold / cumulHold / 买卖信号 / 交易）由各策略自行计算。
 * 新增策略只需实现 Strategy 接口并在 strategies/index.ts 注册。
 */

/** 一笔完整交易（含末根强制平仓）。 */
export interface Trade {
  buyTime: string;
  buyPrice: number;
  buyReason: string;
  sellTime: string;
  sellPrice: number;
  sellReason: string;
  profit: number;
  forcedClose?: boolean; // 回测结束时仍持仓的末根强制平仓：仅用于计算收益，不标记卖出信号/记录
}

/** 带策略输出字段的 K 线（指标字段继承自接口层 KlineBar）。 */
export interface StrategyBar extends KlineBar {
  signal?: 'buy' | 'sell' | null;
  shouldHold?: boolean; // 当前 K 线是否处于值得持仓的状态（由策略判定）
  cumulHold?: number; // 当前 K 线之前连续 shouldHold 的根数（不含自身，遇 false 归零）
  // ── 多周期趋势闸（仅日内周期回测时由 service 层附加，daily 周期/缺失时为 undefined）──
  // 取值为「该 K 线所属交易日的【上一交易日】收盘」的日线趋势状态，避免用当日未收盘的日线产生未来函数。
  dailyUp?: boolean; // 日线中期上行 regime：close>MA60 && MA20>MA60 && MA60 上行
  dailyStrongUp?: boolean; // 日线强趋势：多头排列充分（MA5>MA10>MA20>MA60 + MA60 上行 + close>MA20）
  dailyDown?: boolean; // 日线明确下行：MA20<MA60（中期结构走坏）；走平 regime 既非 up 也非 down
}

/** 策略运行上下文。 */
export interface StrategyContext {
  /** 已含接口层指标的 K 线序列（含回测起点前的历史预热区间）。 */
  bars: StrategyBar[];
  /** 回测区间起始索引；策略只从此处开始开仓。 */
  testStartIndex: number;
  /** 标的是否为场内 ETF（由接口层按市场/代码推断）；策略可据此切换参数集，普通策略可忽略。 */
  isEtf?: boolean;
}

/** 策略运行结果。signals 与 bars 等长，逐根对应买卖信号。 */
export interface StrategyRunResult {
  trades: Trade[];
  signals: (string | null)[];
}

/** 回测策略接口。实现为纯函数（不依赖外部状态），便于独立测试。 */
export interface Strategy {
  /** 稳定标识，作为注册表键与接口 strategy 参数取值；一经确定不可更改。 */
  readonly id: string;
  /** 展示名称，仅用于前端展示，可随时修改而不影响识别。 */
  readonly name: string;
  run(ctx: StrategyContext): StrategyRunResult;
}
