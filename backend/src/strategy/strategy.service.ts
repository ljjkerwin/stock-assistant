import { Injectable, BadRequestException } from '@nestjs/common';
import { KlineService } from '../kline/kline.service';
import type { KlineBar } from '../kline/kline.service';

type KlinePeriod = 'timeshare' | '1min' | '5min' | '15min' | '30min' | '60min' | 'daily' | 'weekly';

interface BacktestParams {
  market: 'A' | 'HK';
  code: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  period: KlinePeriod;
  strategy: string;
  historicalPeriods?: number; // extra periods to load before startDate for indicator calculation
}

export interface TradeRecord {
  type: 'buy' | 'sell';
  time: string;
  price: number;
  reason: string;
  profit?: number; // 仅卖出记录包含
}

export interface BacktestResult {
  priceChangePercent: number; // 区间涨跌 %
  returnPercent: number; // 回测收益 %
  maxDrawdown: number; // 最大回撤 %
  sharpeRatio: number; // 夏普比率
  tradeCount: number; // 完整买卖次数（一买一卖算一次）
  trades: TradeRecord[];
  klines: KlineBarWithSignal[];
}

interface Trade {
  buyTime: string;
  buyPrice: number;
  buyReason: string;
  sellTime: string;
  sellPrice: number;
  sellReason: string;
  profit: number;
}

interface KlineBarWithSignal extends KlineBar {
  signal?: 'buy' | 'sell' | null;
}

@Injectable()
export class StrategyService {
  constructor(private klineService: KlineService) {}

  async backtest(params: BacktestParams): Promise<BacktestResult> {
    const { market, code, startDate, endDate, period, strategy, historicalPeriods = 60 } = params;

    if (!['趋势策略'].includes(strategy)) {
      throw new BadRequestException(`Unknown strategy: ${strategy}`);
    }

    // 获取K线数据
    const klineResp = await this.klineService.getKline(market, code, period);
    const bars = klineResp.data;
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

    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime() + 24 * 60 * 60 * 1000;

    // Load historical data for indicator calculation
    const historicalDate = new Date(startDate);
    historicalDate.setDate(historicalDate.getDate() - historicalPeriods);
    const historicalTs = historicalDate.getTime();

    const allBars = bars.filter((bar) => {
      const barTs = parseTime(bar.time);
      return barTs >= historicalTs && barTs <= endTs;
    });

    if (allBars.length === 0) {
      throw new BadRequestException('No kline data available');
    }

    // Keep track of which bars are in the actual test range
    const filtered = allBars.filter((bar) => {
      const barTs = parseTime(bar.time);
      return barTs >= startTs && barTs <= endTs;
    });

    if (filtered.length === 0) {
      throw new BadRequestException('No data in the specified date range');
    }

    // 计算技术指标 - 使用所有历史数据以确保指标准确
    const barsWithIndicators = this.calculateIndicators(allBars);

    // 执行策略回测 - 在完整数据上运行
    let trades: Trade[] = [];
    let signals: (string | null)[] = [];

    if (strategy === '趋势策略') {
      ({ trades, signals } = this.trendStrategy(barsWithIndicators));
    }

    // 标记信号并过滤回测范围内的交易
    const klineWithSignals = barsWithIndicators.map((bar, i) => ({
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
    const maxDrawdown = this.calculateMaxDrawdown(klineWithSignals, tradesInRange);

    // 计算夏普比率（假设无风险利率为0）
    const sharpeRatio = this.calculateSharpeRatio(klineWithSignals, tradesInRange);

    const tradeRecords: TradeRecord[] = [];
    for (const trade of tradesInRange) {
      tradeRecords.push({
        type: 'buy',
        time: trade.buyTime,
        price: trade.buyPrice,
        reason: trade.buyReason,
      });
      tradeRecords.push({
        type: 'sell',
        time: trade.sellTime,
        price: trade.sellPrice,
        reason: trade.sellReason,
        profit: trade.profit,
      });
    }

    return {
      priceChangePercent,
      returnPercent,
      maxDrawdown,
      sharpeRatio,
      tradeCount: tradesInRange.length,
      trades: tradeRecords,
      klines: klineWithSignals,
    };
  }

  private calculateIndicators(bars: KlineBar[]): KlineBarWithSignal[] {
    return bars.map((bar, i) => {
      const result: KlineBarWithSignal = { ...bar };

      // Update MA values
      result.ma = {
        ma5: this.calculateMA(bars, i, 5),
        ma10: this.calculateMA(bars, i, 10),
        ma20: this.calculateMA(bars, i, 20),
        ma60: this.calculateMA(bars, i, 60),
      };

      // Update MACD values
      const macd = this.calculateMACD(bars, i);
      result.macd = {
        dif: macd.macd,
        dea: macd.signal,
        bar: macd.hist,
      };

      return result;
    });
  }

  private calculateMA(bars: KlineBar[], index: number, period: number): number | null {
    if (index < period - 1) return null;
    let sum = 0;
    for (let i = index - period + 1; i <= index; i++) {
      sum += bars[i].close;
    }
    return sum / period;
  }

  private calculateMACD(
    bars: KlineBar[],
    index: number,
  ): { macd: number; signal: number; hist: number } {
    const fastPeriod = 12;
    const slowPeriod = 26;
    const signalPeriod = 9;

    const fastEMA = this.calculateEMA(bars, index, fastPeriod);
    const slowEMA = this.calculateEMA(bars, index, slowPeriod);
    const macd = fastEMA - slowEMA;

    // 简化实现：使用简单平均作为信号线
    let signalSum = 0;
    let count = 0;
    for (let i = Math.max(0, index - signalPeriod + 1); i <= index; i++) {
      const f = this.calculateEMA(bars, i, fastPeriod);
      const s = this.calculateEMA(bars, i, slowPeriod);
      signalSum += f - s;
      count++;
    }
    const signal = signalSum / count;
    const hist = macd - signal;

    return { macd, signal, hist };
  }

  private calculateEMA(bars: KlineBar[], index: number, period: number): number {
    if (index < period - 1) {
      let sum = 0;
      for (let i = 0; i <= index; i++) {
        sum += bars[i].close;
      }
      return sum / (index + 1);
    }

    const alpha = 2 / (period + 1);
    let ema = 0;
    for (let i = 0; i < period; i++) {
      ema += bars[i].close;
    }
    ema /= period;

    for (let i = period; i <= index; i++) {
      ema = bars[i].close * alpha + ema * (1 - alpha);
    }
    return ema;
  }

  private calculateKDJ(bars: KlineBar[], index: number): { k: number; d: number; j: number } {
    const period = 14;
    if (index < period - 1) {
      return { k: 50, d: 50, j: 50 };
    }

    let highest = bars[index - period + 1].high;
    let lowest = bars[index - period + 1].low;

    for (let i = index - period + 1; i <= index; i++) {
      highest = Math.max(highest, bars[i].high);
      lowest = Math.min(lowest, bars[i].low);
    }

    // 简化实现：RSV的简单平均
    let kdjSum = 0;
    for (let i = Math.max(0, index - 2); i <= index; i++) {
      let h = bars[Math.max(0, i - period + 1)].high;
      let l = bars[Math.max(0, i - period + 1)].low;
      for (let j = Math.max(0, i - period + 1); j <= i; j++) {
        h = Math.max(h, bars[j].high);
        l = Math.min(l, bars[j].low);
      }
      const r = h - l;
      kdjSum += r === 0 ? 50 : ((bars[i].close - l) / r) * 100;
    }
    const k = kdjSum / 3;
    const d = (k + 50 + 50) / 3;
    const j = 3 * k - 2 * d;

    return { k, d, j };
  }

  private calculateRSI(bars: KlineBar[], index: number): number {
    const period = 14;
    if (index < period) {
      return 50;
    }

    let upSum = 0;
    let downSum = 0;

    for (let i = index - period; i < index; i++) {
      const change = bars[i + 1].close - bars[i].close;
      if (change > 0) {
        upSum += change;
      } else {
        downSum += Math.abs(change);
      }
    }

    const rs = upSum / downSum;
    return 100 - 100 / (1 + rs);
  }

  private trendStrategy(bars: KlineBarWithSignal[]): {
    trades: Trade[];
    signals: (string | null)[];
  } {
    const trades: Trade[] = [];
    const signals: Array<string | null> = Array(bars.length).fill(null) as Array<string | null>;
    let position = false;
    let buyTime = '';
    let buyPrice = 0;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];

      // 趋势策略：MA5穿越MA10作为买卖信号
      if (bar.ma.ma5 != null && bar.ma.ma10 != null && i > 0) {
        const prevBar = bars[i - 1];

        // 买入：MA5从下方穿越MA10
        if (!position && prevBar.ma.ma5! <= prevBar.ma.ma10! && bar.ma.ma5 > bar.ma.ma10) {
          position = true;
          buyTime = bar.time;
          buyPrice = bar.close;
          signals[i] = 'buy';
        }

        // 卖出：MA5从上方穿越MA10
        if (position && prevBar.ma.ma5! >= prevBar.ma.ma10! && bar.ma.ma5 < bar.ma.ma10) {
          position = false;
          trades.push({
            buyTime,
            buyPrice,
            buyReason: `MA5(${prevBar.ma.ma5!.toFixed(3)}) 穿越 MA10(${prevBar.ma.ma10!.toFixed(3)})`,
            sellTime: bar.time,
            sellPrice: bar.close,
            sellReason: `MA5(${bar.ma.ma5.toFixed(3)}) 穿越 MA10(${bar.ma.ma10.toFixed(3)})`,
            profit: bar.close - buyPrice,
          });
          signals[i] = 'sell';
        }
      }
    }

    // 如果还有未平仓位置，以最后一根K线收盘价平仓
    if (position && bars.length > 0) {
      const lastBar = bars[bars.length - 1];
      trades.push({
        buyTime,
        buyPrice,
        buyReason: `MA5(${bars[bars.length - 2]?.ma.ma5?.toFixed(3) ?? '--'}) 穿越 MA10(${bars[bars.length - 2]?.ma.ma10?.toFixed(3) ?? '--'})`,
        sellTime: lastBar.time,
        sellPrice: lastBar.close,
        sellReason: '策略回测结束，强制平仓',
        profit: lastBar.close - buyPrice,
      });
      signals[bars.length - 1] = 'sell';
    }

    return { trades, signals };
  }

  private calculateMaxDrawdown(bars: KlineBarWithSignal[], trades: Trade[]): number {
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

  private calculateSharpeRatio(bars: KlineBarWithSignal[], trades: Trade[]): number {
    if (trades.length === 0) {
      return 0;
    }

    const returns: number[] = trades.map((t) => ((t.sellPrice - t.buyPrice) / t.buyPrice) * 100);

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev === 0 ? 0 : avgReturn / stdDev;
  }
}
