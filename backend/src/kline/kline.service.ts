import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { yahooGet } from '../yahoo-session';
import { MemCache, tradingTtl } from '../cache';

// ── Sina (A-shares) ──────────────────────────────────────────────────────────

const SINA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn/',
};

// quotes.sina.cn supports all scales including scale=1; money.finance.sina.com.cn returns null for scale=1
const SINA_KLINE_URL =
  'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData';

const SINA_SCALE_MAP: Record<string, number> = {
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '60min': 60,
  daily: 240,
  weekly: 1680,
};

// ── Yahoo Finance (HK stocks) ────────────────────────────────────────────────

const YAHOO_INTERVAL_MAP: Record<string, string> = {
  timeshare: '1m',
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '30min': '30m',
  '60min': '60m',
  daily: '1d',
  weekly: '1wk',
};

const YAHOO_RANGE_MAP: Record<string, string> = {
  timeshare: '1d',
  '1min': '5d',
  '5min': '1mo',
  '15min': '1mo',
  '30min': '3mo',
  '60min': '6mo',
  daily: '2y',
  weekly: '5y',
};

// ── Shared types ─────────────────────────────────────────────────────────────

interface SinaBar {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface YahooChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface YahooChartResponse {
  chart?: { result?: YahooChartResult[]; error?: unknown };
}

export interface KlineBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePercent: number | null; // 当日涨跌幅 %（相对前一根 K 线收盘价；首根无前收为 null）
  macd: {
    dif: number;
    dea: number;
    bar: number;
  };
  ma: {
    ma5: number | null;
    ma10: number | null;
    ma20: number | null;
    ma60: number | null;
  };
  rsi: {
    rsi6: number | null;
    // 其他周期（如 rsi12、rsi24）暂不计算，需要时再扩展
  };
  // 「ljj」综合属性（布尔），用于回测页 ljj 副图堆叠柱状图
  attrs: {
    kmacd: boolean; // dif > 0 且 dif - dea > -0.02 且 DIF 较前值上升（dif/prevDif > 0.99）
    krsi: boolean; // rsi6 >= 50
    kma: boolean; // 收盘价 > MA10 且 MA5 > MA10
  };
}

/**
 * 计算单根 K 线的「ljj」综合属性。纯函数，供接口层与回测层共用。
 * @param bar 已含 macd / ma / rsi / close 的 K 线
 * @param prevDif 前一根 K 线的 macd.dif（首根传 null）
 */
export function computeKlineAttrs(
  bar: Pick<KlineBar, 'close' | 'macd' | 'ma' | 'rsi'>,
  prevDif: number | null,
): KlineBar['attrs'] {
  const { dif, dea } = bar.macd;
  const { ma5, ma10 } = bar.ma;
  return {
    kmacd: dif > 0 && dif - dea > -0.1 && prevDif != null && (dif > prevDif || dif / prevDif > 0.99),
    krsi: (bar.rsi.rsi6 ?? 0) >= 50,
    kma: ma10 != null && ma5 != null && bar.close > ma10 && ma5 > ma10,
  };
}

interface RawBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

// 盘中TTL（毫秒），盘外统一 1 小时
const KLINE_TRADING_TTL: Record<string, number> = {
  timeshare: 60_000, // 1min
  '1min': 60_000,
  '5min': 180_000, // 3min
  '15min': 180_000,
  '30min': 180_000,
  '60min': 300_000, // 5min
  daily: 300_000,
  weekly: 600_000, // 10min
};

const OFF_HOURS_TTL = 60 * 60_000; // 1h

@Injectable()
export class KlineService {
  private klineCache = new MemCache<KlineBar[]>();

  async getKline(
    market: 'A' | 'HK',
    code: string,
    period: string,
  ): Promise<{
    code: string;
    market: string;
    period: string;
    data: KlineBar[];
  }> {
    const key = `${market}:${code}:${period}`;
    const cached = this.klineCache.get(key);
    if (cached) return { code, market, period, data: cached };

    let raw: RawBar[] = [];
    try {
      raw =
        market === 'A' ? await this.fetchSina(code, period) : await this.fetchYahoo(code, period);
    } catch (err) {
      const msg = (err as Error).message;
      const status = (err as { response?: { status?: number } }).response?.status;
      console.error(
        `[kline] upstream error market=${market} code=${code} period=${period} status=${status ?? 'N/A'} msg=${msg}`,
      );
    }
    const bars = this.calcMACD(raw);
    if (bars.length > 0) {
      const tradingMs = KLINE_TRADING_TTL[period] ?? 300_000;
      this.klineCache.set(key, bars, tradingTtl(tradingMs, OFF_HOURS_TTL));
    }
    return { code, market, period, data: bars };
  }

  // ── Sina (A-shares) ────────────────────────────────────────────────────────

  private async fetchSina(code: string, period: string): Promise<RawBar[]> {
    const symbol = code.startsWith('6') || code.startsWith('5') ? `sh${code}` : `sz${code}`;

    const isTimeshare = period === 'timeshare';
    const scale = isTimeshare ? 1 : (SINA_SCALE_MAP[period] ?? 240);
    const datalen = isTimeshare ? 240 : 500;
    const url = `${SINA_KLINE_URL}?symbol=${symbol}&scale=${scale}&ma=no&datalen=${datalen}`;
    const data = await this.get<SinaBar[]>(url, SINA_HEADERS);
    return this.parseSinaBars(data);
  }

  private parseSinaBars(data: unknown): RawBar[] {
    if (!Array.isArray(data)) return [];
    return (data as SinaBar[]).map((item) => ({
      time: item.day,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume),
    }));
  }

  // ── Yahoo Finance (HK stocks) ──────────────────────────────────────────────

  private async fetchYahoo(code: string, period: string): Promise<RawBar[]> {
    const symbol = this.buildYahooHKSymbol(code);
    const interval = YAHOO_INTERVAL_MAP[period] ?? '1d';
    const range = YAHOO_RANGE_MAP[period] ?? '2y';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&includePrePost=false`;
    const data = await yahooGet<YahooChartResponse>(url);
    return this.parseYahooChart(data, period);
  }

  private parseYahooChart(data: YahooChartResponse, period: string): RawBar[] {
    const result = data?.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    if (!quote) return [];

    const isIntraday = ['timeshare', '1min', '5min', '15min', '30min', '60min'].includes(period);
    const bars: RawBar[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      const volume = quote.volume?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
      bars.push({
        time: this.tsToHKStr(timestamps[i], isIntraday),
        open,
        high,
        low,
        close,
        volume: volume ?? 0,
      });
    }
    return bars;
  }

  private tsToHKStr(ts: number, isIntraday: boolean): string {
    const hkDate = new Date((ts + 8 * 3600) * 1000);
    const iso = hkDate.toISOString();
    return isIntraday ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
  }

  private buildYahooHKSymbol(code: string): string {
    const num = parseInt(code, 10);
    return `${num.toString().padStart(4, '0')}.HK`;
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────

  private async get<T>(url: string, headers: Record<string, string>, retries = 2): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await axios.get<T>(url, { timeout: 8000, headers });
        return res.data;
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw new Error('unreachable');
  }

  // ── MACD(4,35,4) ──────────────────────────────────────────────────────────

  calcMACD(bars: RawBar[]): KlineBar[] {
    const closes = bars.map((b) => b.close);
    const emaShort = this.calcEMA(closes, 4);
    const emaLong = this.calcEMA(closes, 35);
    const dif = emaShort.map((v, i) => v - emaLong[i]);
    const dea = this.calcEMA(dif, 4);
    const macdBar = dif.map((v, i) => (v - dea[i]) * 2);
    const ma5 = this.calcSMA(closes, 5);
    const ma10 = this.calcSMA(closes, 10);
    const ma20 = this.calcSMA(closes, 20);
    const ma60 = this.calcSMA(closes, 60);
    const rsi6 = this.calcRSI(closes, 6);

    const result: KlineBar[] = bars.map((bar, i) => ({
      ...bar,
      changePercent:
        i > 0 && closes[i - 1] !== 0
          ? parseFloat((((bar.close - closes[i - 1]) / closes[i - 1]) * 100).toFixed(2))
          : null,
      macd: {
        dif: parseFloat(dif[i].toFixed(4)),
        dea: parseFloat(dea[i].toFixed(4)),
        bar: parseFloat(macdBar[i].toFixed(4)),
      },
      ma: {
        ma5: ma5[i],
        ma10: ma10[i],
        ma20: ma20[i],
        ma60: ma60[i],
      },
      rsi: {
        rsi6: rsi6[i],
      },
      attrs: { kmacd: false, krsi: false, kma: false },
    }));

    // attrs 依赖前一根的 dif，单独再遍历一次（使用四舍五入后的 dif，与前端历史行为一致）
    result.forEach((bar, i) => {
      bar.attrs = computeKlineAttrs(bar, i > 0 ? result[i - 1].macd.dif : null);
    });

    return result;
  }

  /**
   * RSI 序列（通达信口径，Wilder 平滑）。
   * RSI = SMA(涨幅, N, 1) / (SMA(涨幅, N, 1) + SMA(跌幅, N, 1)) * 100
   * 首根无前收，返回 null。
   */
  private calcRSI(data: number[], period: number): (number | null)[] {
    const n = data.length;
    const result: (number | null)[] = new Array<number | null>(n).fill(null);
    if (n < 2) return result;

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i < n; i++) {
      const change = data[i] - data[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      if (i === 1) {
        avgGain = gain;
        avgLoss = loss;
      } else {
        avgGain = (gain + avgGain * (period - 1)) / period;
        avgLoss = (loss + avgLoss * (period - 1)) / period;
      }

      const denom = avgGain + avgLoss;
      result[i] = parseFloat((denom === 0 ? 50 : (avgGain / denom) * 100).toFixed(2));
    }

    return result;
  }

  private calcSMA(data: number[], period: number): (number | null)[] {
    return data.map((_, i) => {
      if (i < period - 1) return null;
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      return parseFloat((sum / period).toFixed(4));
    });
  }

  private calcEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const result: number[] = [];
    let ema = data[0];
    for (let i = 0; i < data.length; i++) {
      ema = i === 0 ? data[0] : data[i] * k + ema * (1 - k);
      result.push(ema);
    }
    return result;
  }
}
