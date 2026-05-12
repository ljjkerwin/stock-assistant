import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { MemCache, tradingTtl } from '../cache';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
  Origin: 'https://quote.eastmoney.com',
};

export interface StockInfo {
  code: string;
  name: string;
  market: 'A' | 'HK';
  price: number | null;
  change_pct: number | null;
  turnover: number | null;
  market_cap: number | null;
  pe: number | null;
}

export interface SearchResult {
  code: string;
  name: string;
  market: 'A' | 'HK';
}

interface EastmoneySearchItem {
  Code: string;
  Name: string;
  SecurityTypeName: string;
}

interface EastmoneySearchResponse {
  QuotationCodeTable?: { Data?: EastmoneySearchItem[] };
}

interface EastmoneyQuoteData {
  f43?: number | string;
  f47?: number | string;
  f48?: number | string;
  f58?: string;
  f116?: number | string;
  f167?: number | string;
  f170?: number | string;
}

interface EastmoneyQuoteResponse {
  data?: EastmoneyQuoteData;
}

function numOrNull(v: number | string | undefined): number | null {
  if (v == null || v === '-') return null;
  return typeof v === 'number' ? v : parseFloat(String(v));
}

const INFO_TTL_TRADING = 30_000; // 盘中 30s
const INFO_TTL_OFF_HOURS = 10 * 60_000; // 盘外 10min

@Injectable()
export class StocksService {
  private infoCache = new MemCache<StockInfo>();

  async search(q: string): Promise<SearchResult[]> {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(q)}&type=14&token=D43BF722C8E33BDC906FB84D85E326EC&count=20`;
    const res = await axios
      .get<EastmoneySearchResponse>(url, { timeout: 5000, headers: BROWSER_HEADERS })
      .catch((err: Error) => {
        throw new HttpException(
          `Failed to fetch search results: ${err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      });
    const list: SearchResult[] = [];
    const data = res.data?.QuotationCodeTable?.Data;
    if (!Array.isArray(data)) return list;

    for (const item of data) {
      const code = item.Code ?? '';
      const name = item.Name ?? '';
      const market = item.SecurityTypeName;
      if (!code || !name) continue;
      if (market === '港股') {
        list.push({ code, name, market: 'HK' });
      } else if (
        ['沪A', '深A', '沪市', '深市', 'A股', '上交所', '深交所'].some((m) =>
          String(market).includes(m),
        )
      ) {
        list.push({ code, name, market: 'A' });
      }
    }
    return list;
  }

  async getInfo(market: 'A' | 'HK', code: string): Promise<StockInfo> {
    const key = `${market}:${code}`;
    const cached = this.infoCache.get(key);
    if (cached) return cached;
    const info = market === 'HK' ? await this.getInfoHK(code) : await this.getInfoAShare(code);
    this.infoCache.set(key, info, tradingTtl(INFO_TTL_TRADING, INFO_TTL_OFF_HOURS));
    return info;
  }

  private async getInfoAShare(code: string): Promise<StockInfo> {
    const secid = this.buildAShareSecid(code);
    const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f116,f167,f170`;
    const res = await axios
      .get<EastmoneyQuoteResponse>(url, { timeout: 5000, headers: BROWSER_HEADERS })
      .catch((err: Error) => {
        throw new HttpException(
          `Failed to fetch stock info: ${err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      });
    const d = res.data?.data ?? {};

    const f43 = numOrNull(d.f43);
    const f47 = numOrNull(d.f47);
    const f48 = numOrNull(d.f48);
    const f116 = numOrNull(d.f116);
    const f167 = numOrNull(d.f167);
    const f170 = numOrNull(d.f170);

    const price = f43 != null ? f43 / 100 : null;
    const change_pct = f170 != null ? f170 / 100 : f47 != null ? f47 / 100 : null;
    const market_cap = f116;
    const pe = f167 != null ? f167 / 100 : null;
    const turnover = f48;

    return {
      code,
      name: d.f58 ?? '',
      market: 'A',
      price,
      change_pct,
      turnover,
      market_cap,
      pe,
    };
  }

  private async getInfoHK(code: string): Promise<StockInfo> {
    const secid = `116.${code.padStart(5, '0')}`;
    const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f47,f48,f58,f116,f167,f170`;
    const res = await axios
      .get<EastmoneyQuoteResponse>(url, { timeout: 5000, headers: BROWSER_HEADERS })
      .catch((err: Error) => {
        throw new HttpException(
          `Failed to fetch HK stock info: ${err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      });
    const d = res.data?.data ?? {};
    const f43 = numOrNull(d.f43);
    const f167 = numOrNull(d.f167);
    const f170 = numOrNull(d.f170);
    return {
      code,
      name: d.f58 ?? '',
      market: 'HK',
      price: f43 != null ? f43 / 1000 : null,
      change_pct: f170 != null ? f170 / 100 : null,
      turnover: numOrNull(d.f48),
      market_cap: numOrNull(d.f116),
      pe: f167 != null ? f167 / 10 : null,
    };
  }

  private buildAShareSecid(code: string): string {
    const prefix = code.startsWith('6') ? '1' : '0';
    return `${prefix}.${code}`;
  }
}
