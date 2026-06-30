import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { yahooGet } from '../yahoo-session';
import { MemCache, tradingTtl } from '../cache';

// ── 腾讯财经（A股/ETF 全周期 + 港股日/周线；日/周线前复权 qfq）────────────────
//
// 数据源选型说明：东方财富 push2his 按 IP 强限流（几次请求即拒连），不适合做主源；
// 新浪 getKLineData 不支持复权。腾讯 ifzq 接口原生支持前复权且对抓取宽松、国内直连。

const TENCENT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://gu.qq.com/',
};

const TENCENT_FQKLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'; // 日/周线，支持 qfq 前复权
const TENCENT_MKLINE_URL = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline'; // 分钟线（不复权，仅 A股/ETF）

// 周期 → 腾讯 fqkline 周期码（日/周线，前复权）
const TENCENT_FQ_MAP: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
};

// 周期 → 腾讯 mkline 分钟周期码（A股/ETF 分时与分钟线，不复权；分时用 m1）
const TENCENT_MIN_MAP: Record<string, string> = {
  timeshare: 'm1',
  '1min': 'm1',
  '5min': 'm5',
  '15min': 'm15',
  '30min': 'm30',
  '60min': 'm60',
};

const TENCENT_LIMIT = 500; // 日/周线 fqkline 拉取根数（500 日线≈2 年，足够）
// 分钟线 mkline 拉取根数：腾讯对该接口有 800 根硬上限，请求 >800 会静默回退到默认 320 根，
// 故取满 800 以最大化日内历史（15min≈最近 50 个交易日，30min≈近半年，60min≈近 1 年）。
const TENCENT_MIN_LIMIT = 800;

// ── Yahoo Finance（港股分时/分钟线，不复权）──────────────────────────────────

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

interface TencentKlineResponse {
  code?: number;
  data?: Record<string, Record<string, unknown>>;
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
  // BOLL(20,2) 布林带：中轨 = MA20，上/下轨 = 中轨 ± 2×总体标准差（通达信口径）
  boll: {
    upper: number | null;
    mid: number | null;
    lower: number | null;
  };
  rsi: {
    rsi6: number | null;
    // 其他周期（如 rsi12、rsi24）暂不计算，需要时再扩展
  };
  // 「ljj」综合属性（布尔），用于回测页 ljj 副图堆叠柱状图
  attrs: {
    kmacd: boolean; // dif > 0 且 dif - dea > -0.1 且 DIF 较前值上升（dif - prevDif > -0.06，允许微跌）
    krsi: boolean; // rsi6 >= 50
    kma: boolean; // 收盘价 > MA10 且 MA5 / MA10 > 0.995
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
    kmacd: dif > 0 && dif - dea > -0.1 && prevDif != null && dif - prevDif > -0.06,
    krsi: (bar.rsi.rsi6 ?? 0) >= 50,
    kma: ma10 != null && ma5 != null && bar.close > ma10 && ma5 / ma10 > 0.995,
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
      raw = await this.fetchBars(market, code, period);
    } catch (err) {
      const msg = (err as Error).message;
      const status = (err as { response?: { status?: number } }).response?.status;
      console.error(
        `[kline] upstream error market=${market} code=${code} period=${period} status=${status ?? 'N/A'} msg=${msg}`,
      );
    }
    const bars = this.calcMACD(raw);
    let filteredBars = bars;
    if (period === 'timeshare' && bars.length > 0) {
      const lastDate = bars[bars.length - 1].time.slice(0, 10);
      filteredBars = bars.filter((b) => b.time.startsWith(lastDate));
    }
    if (filteredBars.length > 0) {
      const tradingMs = KLINE_TRADING_TTL[period] ?? 300_000;
      this.klineCache.set(key, filteredBars, tradingTtl(tradingMs, OFF_HOURS_TTL));
    }
    return { code, market, period, data: filteredBars };
  }

  /**
   * 路由：
   * - 日/周线（需前复权）：A股/ETF 与港股均走腾讯 fqkline（qfq）
   * - 分时/分钟线（不复权）：A股/ETF 走腾讯 mkline；港股走 Yahoo（腾讯不提供港股分钟线）
   */
  private async fetchBars(market: 'A' | 'HK', code: string, period: string): Promise<RawBar[]> {
    if (period === 'daily' || period === 'weekly') {
      return this.fetchTencentFq(market, code, period);
    }
    return market === 'A' ? this.fetchTencentMin(code, period) : this.fetchYahoo(code, period);
  }

  // ── 腾讯财经 ─────────────────────────────────────────────────────────────────

  /**
   * 腾讯 symbol：港股 `hk` + 5 位代码（如 hk00700）；
   * A股/ETF `6`/`5` 开头用 `sh`（沪市，含 51xxxx ETF），其余用 `sz`（深市，含 15xxxx ETF）。
   */
  private buildTencentSymbol(market: 'A' | 'HK', code: string): string {
    if (market === 'HK') {
      const num = parseInt(code, 10);
      return `hk${num.toString().padStart(5, '0')}`;
    }
    return (code.startsWith('6') || code.startsWith('5') ? 'sh' : 'sz') + code;
  }

  /** 日/周线前复权（fqkline?...,qfq）。A股/ETF 返回 `qfqday`/`qfqweek`，港股返回 `day`/`week`。 */
  private async fetchTencentFq(
    market: 'A' | 'HK',
    code: string,
    period: string,
  ): Promise<RawBar[]> {
    const symbol = this.buildTencentSymbol(market, code);
    const pk = TENCENT_FQ_MAP[period] ?? 'day';
    const url = `${TENCENT_FQKLINE_URL}?param=${symbol},${pk},,,${TENCENT_LIMIT},qfq`;
    const resp = await this.get<TencentKlineResponse>(url, TENCENT_HEADERS);
    const node = resp?.data?.[symbol];
    const rows = (node?.[`qfq${pk}`] ?? node?.[pk]) as unknown[] | undefined;
    return this.parseTencentRows(rows);
  }

  /** 分时/分钟线（mkline，不复权，仅 A股/ETF）。返回键即周期码（m1/m5/...）。 */
  private async fetchTencentMin(code: string, period: string): Promise<RawBar[]> {
    const symbol = this.buildTencentSymbol('A', code);
    const mk = TENCENT_MIN_MAP[period] ?? 'm5';
    const url = `${TENCENT_MKLINE_URL}?param=${symbol},${mk},,${TENCENT_MIN_LIMIT}`;
    const resp = await this.get<TencentKlineResponse>(url, TENCENT_HEADERS);
    const rows = resp?.data?.[symbol]?.[mk] as unknown[] | undefined;
    return this.parseTencentRows(rows);
  }

  /**
   * 解析腾讯 K 线行：每行为数组 `[时间, 开, 收, 高, 低, 量, ...]`（港股日线行尾附带分红对象，忽略）。
   * 时间为 `YYYY-MM-DD`（日/周线）或 `YYYYMMDDHHMM`（分钟线），统一为图表所需格式。
   */
  private parseTencentRows(rows?: unknown[]): RawBar[] {
    if (!Array.isArray(rows)) return [];
    const bars: RawBar[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const r = row as string[];
      const time = this.fmtTencentTime(r[0]);
      const open = parseFloat(r[1]);
      const close = parseFloat(r[2]);
      const high = parseFloat(r[3]);
      const low = parseFloat(r[4]);
      const volume = parseFloat(r[5]);
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
      bars.push({ time, open, high, low, close, volume: isNaN(volume) ? 0 : volume });
    }
    return bars;
  }

  /** `YYYYMMDDHHMM` → `YYYY-MM-DD HH:MM`；已含 `-` 的日期串原样返回。 */
  private fmtTencentTime(raw: string): string {
    if (raw.includes('-')) return raw;
    if (raw.length === 12) {
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
    }
    return raw;
  }

  // ── Yahoo Finance（港股分时/分钟线）──────────────────────────────────────────

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

  // ── MACD(12,26,9) ─────────────────────────────────────────────────────────

  calcMACD(bars: RawBar[]): KlineBar[] {
    const closes = bars.map((b) => b.close);
    const emaShort = this.calcEMA(closes, 12);
    const emaLong = this.calcEMA(closes, 26);
    const dif = emaShort.map((v, i) => v - emaLong[i]);
    const dea = this.calcEMA(dif, 9);
    const macdBar = dif.map((v, i) => (v - dea[i]) * 2);
    const ma5 = this.calcSMA(closes, 5);
    const ma10 = this.calcSMA(closes, 10);
    const ma20 = this.calcSMA(closes, 20);
    const ma60 = this.calcSMA(closes, 60);
    const boll = this.calcBOLL(closes, 20, 2);
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
      boll: boll[i],
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

  /**
   * BOLL 布林带序列。中轨为 N 周期 SMA，上/下轨为中轨 ± mult × 总体标准差
   * （除数为 N，通达信/同花顺口径）。窗口不足 period 根时三轨均为 null。
   */
  private calcBOLL(data: number[], period: number, mult: number): KlineBar['boll'][] {
    return data.map((_, i) => {
      if (i < period - 1) return { upper: null, mid: null, lower: null };
      const window = data.slice(i - period + 1, i + 1);
      const mid = window.reduce((a, b) => a + b, 0) / period;
      const variance = window.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
      const std = Math.sqrt(variance);
      return {
        upper: parseFloat((mid + mult * std).toFixed(4)),
        mid: parseFloat(mid.toFixed(4)),
        lower: parseFloat((mid - mult * std).toFixed(4)),
      };
    });
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
