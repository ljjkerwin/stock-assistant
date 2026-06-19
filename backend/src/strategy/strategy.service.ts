import { Injectable, BadRequestException } from '@nestjs/common';
import { KlineService } from '../kline/kline.service';
import { getStrategy, strategyIds } from './strategies';
import type { StrategyBar, Trade } from './strategies';

type KlinePeriod = 'timeshare' | '1min' | '5min' | '15min' | '30min' | '60min' | 'daily' | 'weekly';

interface BacktestParams {
  market: 'A' | 'HK';
  code: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  period: KlinePeriod;
  strategy: string;
  historicalPeriods?: number; // 回测起点前额外预取的 K 线根数（用于 cumulHold 连续性等）
}

export interface TradeRecord {
  type: 'buy' | 'sell';
  time: string;
  price: number;
  reason: string;
  profit?: number; // 盈亏百分比 %，仅卖出记录包含
}

export interface BacktestResult {
  priceChangePercent: number; // 区间涨跌 %
  returnPercent: number; // 回测收益 %
  maxDrawdown: number; // 最大回撤 %
  sharpeRatio: number; // 夏普比率
  tradeCount: number; // 买卖动作总次数（买入算一次、卖出算一次）
  trades: TradeRecord[];
  klines: StrategyBar[];
  backtestStartTime: string | null; // 回测区间第一根 K 线的时间，用于图表标注
}

@Injectable()
export class StrategyService {
  constructor(private klineService: KlineService) {}

  async backtest(params: BacktestParams): Promise<BacktestResult> {
    const { market, code, startDate, endDate, period, strategy, historicalPeriods = 70 } = params;

    const strategyImpl = getStrategy(strategy);
    if (!strategyImpl) {
      throw new BadRequestException(
        `Unknown strategy: ${strategy}. Available: ${strategyIds().join(', ')}`,
      );
    }

    // 获取 K 线数据（指标 macd/ma/rsi/attrs 已由接口层 KlineService 计算并附带）
    const klineResp = await this.klineService.getKline(market, code, period);
    const bars = klineResp.data as StrategyBar[];
    if (!bars || bars.length === 0) {
      throw new BadRequestException('No kline data available');
    }

    // 按时间筛选 - bars.time 是字符串格式 "YYYY-MM-DD HH:MM"
    const parseTime = (timeStr: string): number => {
      const [date, time] = timeStr.split(' ');
      const [y, mo, d] = date.split('-').map(Number);
      const [h, mi] = time ? time.split(':').map(Number) : [0, 0];
      return new Date(y, mo - 1, d, h, mi).getTime();
    };

    // Use parseTime (local time) consistently to avoid UTC vs local midnight mismatch
    const startTs = parseTime(startDate);
    const endTs = parseTime(endDate) + 24 * 60 * 60 * 1000;

    // 截取到 endDate 的所有 K 线
    const barsToEnd = bars.filter((bar) => parseTime(bar.time) <= endTs);

    // 找到 startDate 在 barsToEnd 中的位置
    const startIndexInFull = barsToEnd.findIndex((bar) => parseTime(bar.time) >= startTs);
    if (startIndexInFull === -1) {
      throw new BadRequestException('No data in the specified date range');
    }

    // 向前多取 historicalPeriods 根 K 线（指标已在全量序列上算好，此处仅为 cumulHold 等连续性预热）
    const histStartIndex = Math.max(0, startIndexInFull - historicalPeriods);
    const allBars = barsToEnd.slice(histStartIndex);

    // 回测区间在 allBars 中的起始索引，策略只从此处开始开仓
    const testStartIndex = startIndexInFull - histStartIndex;

    // 回测范围内的 K 线（用于区间涨跌等指标）
    const filtered = allBars.filter((bar) => {
      const barTs = parseTime(bar.time);
      return barTs >= startTs && barTs <= endTs;
    });

    // 执行策略：策略层消费接口层指标，输出买卖信号与交易
    const { trades, signals } = strategyImpl.run({ bars: allBars, testStartIndex });

    // 标记信号
    const klineWithSignals: StrategyBar[] = allBars.map((bar, i) => ({
      ...bar,
      signal: signals[i] as 'buy' | 'sell' | null,
    }));

    // 只计算回测范围内的交易结果
    const backtestStart = parseTime(filtered[0].time);
    const backtestEnd = parseTime(filtered[filtered.length - 1].time);
    const tradesInRange = trades.filter((t) => {
      const buyTs = parseTime(t.buyTime);
      return buyTs >= backtestStart && buyTs <= backtestEnd;
    });

    // 计算回测指标
    const priceChangePercent =
      ((filtered[filtered.length - 1].close - filtered[0].open) / filtered[0].open) * 100;

    let returnPercent = 0;
    if (tradesInRange.length > 0) {
      const startCapital = 100;
      let balance = startCapital;
      for (const trade of tradesInRange) {
        const profitRate = (trade.profit / trade.buyPrice) * 100;
        balance *= 1 + profitRate / 100;
      }
      returnPercent = ((balance - startCapital) / startCapital) * 100;
    }

    // 计算最大回撤
    const maxDrawdown = this.calculateMaxDrawdown(tradesInRange);

    // 计算夏普比率（基于净值逐周期收益率，按 K 线周期年化；假设无风险利率为 0）
    const sharpeRatio = this.calculateSharpeRatio(filtered, tradesInRange, period);

    const tradeRecords: TradeRecord[] = [];
    for (const trade of tradesInRange) {
      tradeRecords.push({
        type: 'buy',
        time: trade.buyTime,
        price: trade.buyPrice,
        reason: trade.buyReason,
      });
      // 末根强制平仓不生成卖出记录，但其盈亏仍计入 returnPercent 等指标
      if (!trade.forcedClose) {
        tradeRecords.push({
          type: 'sell',
          time: trade.sellTime,
          price: trade.sellPrice,
          reason: trade.sellReason,
          profit: ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * 100,
        });
      }
    }

    return {
      priceChangePercent,
      returnPercent,
      maxDrawdown,
      sharpeRatio,
      tradeCount: tradesInRange.length * 2, // 每笔交易含一次买入 + 一次卖出（末根强制平仓的卖出也计入）
      trades: tradeRecords,
      klines: klineWithSignals,
      backtestStartTime: testStartIndex >= 0 ? (allBars[testStartIndex]?.time ?? null) : null,
    };
  }

  private calculateMaxDrawdown(trades: Trade[]): number {
    if (trades.length === 0) {
      return 0;
    }

    let maxDrawdown = 0;
    let peak = 100;

    for (const trade of trades) {
      const tradeReturn = ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * 100;
      peak = Math.max(peak, 100 * (1 + tradeReturn / 100));
      const drawdown = ((peak - 100 * (1 + tradeReturn / 100)) / peak) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  /** A 股一年约 252 个交易日（年化基准）。 */
  private static readonly TRADING_DAYS_PER_YEAR = 252;
  /** A 股每个交易日（240 分钟连续竞价）各周期的 K 线根数，用于日内周期的夏普年化。 */
  private static readonly BARS_PER_DAY: Record<string, number> = {
    '1min': 240,
    '5min': 48,
    '15min': 16,
    '30min': 8,
    '60min': 4,
  };

  /**
   * 夏普年化因子 √(每年周期数)，按 K 线周期自适应：
   * - daily → √252；weekly → √52；日内（Nmin）→ √(252 × 每日根数)。
   * - 未知/分时等退化为日线基准（√252）。
   */
  private annualizationFactor(period: string): number {
    const D = StrategyService.TRADING_DAYS_PER_YEAR;
    if (period === 'weekly') return Math.sqrt(52);
    if (period === 'daily') return Math.sqrt(D);
    const barsPerDay = StrategyService.BARS_PER_DAY[period];
    return Math.sqrt(barsPerDay ? D * barsPerDay : D);
  }

  /**
   * 年化夏普比率（无风险利率假设为 0）。
   *
   * 按**净值曲线的逐周期收益率**计算，而非「每笔交易收益率」——后者在交易笔数少、收益率彼此
   * 接近时分母（标准差）会塌缩，产出 ±10~±30 的伪值。做法：
   * - 持仓期（入场后到卖出，含卖出根）按收盘 mark-to-market：`close[i]/close[i-1]-1`；
   * - 空仓期收益率记 0（持有现金）。
   * - Sharpe = mean / std × 年化因子（按周期自适应，见 {@link annualizationFactor}；样本标准差 ÷(N-1)）。
   *
   * 空仓期纳入样本，使「少量、低离散」的交易不再塌缩分母；标的若几乎不开仓，Sharpe 趋近 0。
   */
  private calculateSharpeRatio(bars: StrategyBar[], trades: Trade[], period: string): number {
    const n = bars.length;
    if (n < 2 || trades.length === 0) {
      return 0;
    }

    const indexByTime = new Map<string, number>();
    bars.forEach((b, i) => indexByTime.set(b.time, i));

    // 标记持仓日：入场日以收盘价买入，当日不计收益；其后每日（含卖出日）按收盘 mark-to-market
    const held = new Array<boolean>(n).fill(false);
    for (const t of trades) {
      const buyIdx = indexByTime.get(t.buyTime);
      const sellIdx = indexByTime.get(t.sellTime);
      if (buyIdx == null || sellIdx == null) continue;
      for (let i = buyIdx + 1; i <= sellIdx; i++) held[i] = true;
    }

    const daily: number[] = [];
    for (let i = 1; i < n; i++) {
      daily.push(held[i] ? bars[i].close / bars[i - 1].close - 1 : 0);
    }
    if (daily.length < 2) {
      return 0;
    }

    const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
    const variance = daily.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (daily.length - 1);
    const stdDev = Math.sqrt(variance);

    return stdDev === 0 ? 0 : (mean / stdDev) * this.annualizationFactor(period);
  }
}
