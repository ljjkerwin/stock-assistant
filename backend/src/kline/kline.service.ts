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
  macd: {
    dif: number;
    dea: number;
    bar: number;
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
  timeshare:  60_000,   // 1min
  '1min':     60_000,
  '5min':    180_000,   // 3min
  '15min':   180_000,
  '30min':   180_000,
  '60min':   300_000,   // 5min
  daily:     300_000,
  weekly:    600_000,   // 10min
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
        market === 'A'
          ? await this.fetchSina(code, period)
          : await this.fetchYahoo(code, period);
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
    const symbol = code.startsWith('6') ? `sh${code}` : `sz${code}`;

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

    return bars.map((bar, i) => ({
      ...bar,
      macd: {
        dif: parseFloat(dif[i].toFixed(4)),
        dea: parseFloat(dea[i].toFixed(4)),
        bar: parseFloat(macdBar[i].toFixed(4)),
      },
    }));
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
