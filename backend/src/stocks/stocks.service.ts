import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import axios from 'axios';
import { MemCache, tradingTtl } from '../cache';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
  Origin: 'https://quote.eastmoney.com',
};

const SINA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn/',
};

const TENCENT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://gu.qq.com/',
};

export interface StockInfo {
  code: string;
  name: string;
  market: 'A' | 'HK';
  price: number | null;
  change_pct: number | null;
  turnover: number | null;
  volume: number | null;
  turnover_rate: number | null;
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

const INFO_TTL_TRADING = 30_000; // 盘中 30s
const INFO_TTL_OFF_HOURS = 10 * 60_000; // 盘外 10min

@Injectable()
export class StocksService {
  private readonly logger = new Logger(StocksService.name);
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
        ['沪A', '深A', '沪市', '深市', 'A股', '科创板', '上交所', '深交所', '基金'].some((m) =>
          String(market).includes(m),
        )
      ) {
        list.push({ code, name, market: 'A' });
      }
    }
    return list;
  }

  async getBatchInfo(symbols: string[]): Promise<Record<string, StockInfo>> {
    if (symbols.length === 0) return {};

    const result: Record<string, StockInfo> = {};
    const missingSymbols: { market: 'A' | 'HK'; code: string; key: string; sinaSymbol: string }[] =
      [];

    for (const sym of symbols) {
      const parts = sym.split(':');
      if (parts.length !== 2) continue;
      const market = parts[0] as 'A' | 'HK';
      const code = parts[1];
      const key = `${market}:${code}`;
      const cached = this.infoCache.get(key);
      if (cached) {
        result[key] = cached;
      } else {
        const sinaSymbol =
          market === 'HK'
            ? 'hk' + code.padStart(5, '0')
            : (code.startsWith('6') || code.startsWith('5') ? 'sh' : 'sz') + code;
        missingSymbols.push({ market, code, key, sinaSymbol });
      }
    }

    if (missingSymbols.length > 0) {
      try {
        await this.getBatchInfoTencent(missingSymbols, result);
      } catch (err) {
        this.logger.warn(
          `Failed to batch fetch Tencent quotes: ${(err as Error).message}, falling back to Sina`,
        );
        await this.getBatchInfoSina(missingSymbols, result);
      }
    }

    return result;
  }

  private async getBatchInfoTencent(
    missingSymbols: { market: 'A' | 'HK'; code: string; key: string; sinaSymbol: string }[],
    result: Record<string, StockInfo>,
  ): Promise<void> {
    const tencentSymbolsStr = missingSymbols.map((item) => item.sinaSymbol).join(',');
    const url = `https://qt.gtimg.cn/q=${tencentSymbolsStr}`;
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: TENCENT_HEADERS,
    });
    const text = new TextDecoder('gbk').decode(res.data);
    const lines = text.split('\n').filter((l) => l.trim());

    for (const item of missingSymbols) {
      const line = lines.find((l) => l.includes(`v_${item.sinaSymbol}=`));
      if (!line) continue;

      const match = line.match(/"([^"]*)"/);
      if (!match) continue;
      const csv = match[1];
      const fields = csv.split('~');
      if (fields.length < 38) continue;

      const name = fields[1];
      const price = parseFloat(fields[3]);
      const change_pct = parseFloat(fields[32]);

      let info: StockInfo;
      if (item.market === 'A') {
        const turnoverVal = fields[57] ? parseFloat(fields[57]) : parseFloat(fields[37]);
        const turnover = isNaN(turnoverVal) ? null : Math.round(turnoverVal * 10000);
        const volumeVal = parseFloat(fields[6]);
        const volume = isNaN(volumeVal) ? null : Math.round(volumeVal * 100);
        const turnoverRateVal = parseFloat(fields[38]);
        const turnover_rate = isNaN(turnoverRateVal) ? null : turnoverRateVal;
        const marketCapVal = parseFloat(fields[45]);
        const market_cap = isNaN(marketCapVal) ? null : Math.round(marketCapVal * 100000000);
        const peVal = parseFloat(fields[39]);
        const pe = isNaN(peVal) ? null : peVal;

        info = {
          code: item.code,
          name,
          market: 'A',
          price: isNaN(price) || price === 0 ? null : price,
          change_pct: isNaN(change_pct) ? null : change_pct,
          turnover,
          volume,
          turnover_rate,
          market_cap,
          pe,
        };
      } else {
        const turnover = parseFloat(fields[37]);
        const volumeVal = parseFloat(fields[6]);
        const volume = isNaN(volumeVal) ? null : volumeVal;
        const turnoverRateVal = parseFloat(fields[38]);
        const turnover_rate = isNaN(turnoverRateVal) ? null : turnoverRateVal;
        const marketCapVal = parseFloat(fields[45]);
        const market_cap = isNaN(marketCapVal) ? null : Math.round(marketCapVal * 100000000);
        const peVal = parseFloat(fields[39]);
        const pe = isNaN(peVal) ? null : peVal;

        info = {
          code: item.code,
          name,
          market: 'HK',
          price: isNaN(price) || price === 0 ? null : price,
          change_pct: isNaN(change_pct) ? null : change_pct,
          turnover: isNaN(turnover) ? null : turnover,
          volume,
          turnover_rate,
          market_cap,
          pe,
        };
      }

      result[item.key] = info;
      this.infoCache.set(item.key, info, tradingTtl(INFO_TTL_TRADING, INFO_TTL_OFF_HOURS));
    }
  }

  private async getBatchInfoSina(
    missingSymbols: { market: 'A' | 'HK'; code: string; key: string; sinaSymbol: string }[],
    result: Record<string, StockInfo>,
  ): Promise<void> {
    const sinaSymbolsStr = missingSymbols.map((item) => item.sinaSymbol).join(',');
    const url = `https://hq.sinajs.cn/list=${sinaSymbolsStr}`;

    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: SINA_HEADERS,
      });
      const text = new TextDecoder('gbk').decode(res.data);
      const lines = text.split('\n').filter((l) => l.trim());

      for (const item of missingSymbols) {
        const line = lines.find((l) => l.includes(`hq_str_${item.sinaSymbol}=`));
        if (!line) continue;

        const match = line.match(/"([^"]*)"/);
        if (!match) continue;
        const csv = match[1];
        const r = csv.split(',');
        if (r.length < 10) continue;

        let info: StockInfo;
        if (item.market === 'A') {
          const name = r[0];
          const preClose = parseFloat(r[2]);
          const price = parseFloat(r[3]);
          const change_pct =
            preClose > 0 ? parseFloat((((price - preClose) / preClose) * 100).toFixed(2)) : null;
          const turnover = parseFloat(r[9]);
          const volume = parseFloat(r[8]);
          info = {
            code: item.code,
            name,
            market: 'A',
            price: isNaN(price) || price === 0 ? null : price,
            change_pct,
            turnover: isNaN(turnover) ? null : turnover,
            volume: isNaN(volume) ? null : volume,
            turnover_rate: null,
            market_cap: null,
            pe: null,
          };
        } else {
          const name = r[1];
          const price = parseFloat(r[6]);
          const change_pct = parseFloat(r[8]);
          const turnover = parseFloat(r[11]);
          const volume = parseFloat(r[12]);
          info = {
            code: item.code,
            name,
            market: 'HK',
            price: isNaN(price) || price === 0 ? null : price,
            change_pct: isNaN(change_pct) ? null : change_pct,
            turnover: isNaN(turnover) ? null : turnover,
            volume: isNaN(volume) ? null : volume,
            turnover_rate: null,
            market_cap: null,
            pe: null,
          };
        }

        result[item.key] = info;
        this.infoCache.set(item.key, info, tradingTtl(INFO_TTL_TRADING, INFO_TTL_OFF_HOURS));
      }
    } catch (err) {
      this.logger.error(`Failed to batch fetch Sina quotes: ${(err as Error).message}`);
    }
  }

  async getInfo(market: 'A' | 'HK', code: string): Promise<StockInfo> {
    const key = `${market}:${code}`;
    const cached = this.infoCache.get(key);
    if (cached) return cached;

    let info: StockInfo;
    if (market === 'HK') {
      try {
        info = await this.getInfoHKTencent(code);
      } catch (err) {
        this.logger.warn(
          `Failed to fetch HK stock info from Tencent for ${code}, falling back to Sina: ${(err as Error).message}`,
        );
        info = await this.getInfoHKSina(code);
      }
    } else {
      try {
        info = await this.getInfoAShareTencent(code);
      } catch (err) {
        this.logger.warn(
          `Failed to fetch A-share stock info from Tencent for ${code}, falling back to Sina: ${(err as Error).message}`,
        );
        info = await this.getInfoAShareSina(code);
      }
    }

    this.infoCache.set(key, info, tradingTtl(INFO_TTL_TRADING, INFO_TTL_OFF_HOURS));
    return info;
  }

  private async getInfoAShareTencent(code: string): Promise<StockInfo> {
    const symbol = (code.startsWith('6') || code.startsWith('5') ? 'sh' : 'sz') + code;
    const url = `https://qt.gtimg.cn/q=${symbol}`;
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: TENCENT_HEADERS,
    });
    const text = new TextDecoder('gbk').decode(res.data);
    const match = text.match(/"([^"]*)"/);
    if (!match) {
      throw new Error('Invalid Tencent response format');
    }
    const fields = match[1].split('~');
    if (fields.length < 38) {
      throw new Error('Invalid Tencent fields data');
    }
    const name = fields[1];
    const price = parseFloat(fields[3]);
    const change_pct = parseFloat(fields[32]);
    const turnoverVal = fields[57] ? parseFloat(fields[57]) : parseFloat(fields[37]);
    const turnover = isNaN(turnoverVal) ? null : Math.round(turnoverVal * 10000);
    const volumeVal = parseFloat(fields[6]);
    const volume = isNaN(volumeVal) ? null : Math.round(volumeVal * 100);
    const turnoverRateVal = parseFloat(fields[38]);
    const turnover_rate = isNaN(turnoverRateVal) ? null : turnoverRateVal;
    const marketCapVal = parseFloat(fields[45]);
    const market_cap = isNaN(marketCapVal) ? null : Math.round(marketCapVal * 100000000);
    const peVal = parseFloat(fields[39]);
    const pe = isNaN(peVal) ? null : peVal;

    return {
      code,
      name,
      market: 'A',
      price: isNaN(price) || price === 0 ? null : price,
      change_pct: isNaN(change_pct) ? null : change_pct,
      turnover,
      volume,
      turnover_rate,
      market_cap,
      pe,
    };
  }

  private async getInfoAShareSina(code: string): Promise<StockInfo> {
    const symbol = (code.startsWith('6') || code.startsWith('5') ? 'sh' : 'sz') + code;
    const url = `https://hq.sinajs.cn/list=${symbol}`;
    const res = await axios
      .get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 5000, headers: SINA_HEADERS })
      .catch((err: Error) => {
        throw new HttpException(
          `Failed to fetch stock info from both Tencent and Sina: ${err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      });
    const text = new TextDecoder('gbk').decode(res.data);
    const match = text.match(/"([^"]*)"/);
    if (!match) {
      throw new HttpException('Invalid Sina response format', HttpStatus.BAD_GATEWAY);
    }
    const csv = match[1];
    const r = csv.split(',');
    if (r.length < 10) {
      throw new HttpException('Invalid Sina csv data', HttpStatus.BAD_GATEWAY);
    }
    const name = r[0];
    const preClose = parseFloat(r[2]);
    const price = parseFloat(r[3]);
    const change_pct =
      preClose > 0 ? parseFloat((((price - preClose) / preClose) * 100).toFixed(2)) : null;
    const turnover = parseFloat(r[9]);
    const volume = parseFloat(r[8]);

    return {
      code,
      name,
      market: 'A',
      price: isNaN(price) || price === 0 ? null : price,
      change_pct,
      turnover: isNaN(turnover) ? null : turnover,
      volume: isNaN(volume) ? null : volume,
      turnover_rate: null,
      market_cap: null,
      pe: null,
    };
  }

  private async getInfoHKTencent(code: string): Promise<StockInfo> {
    const symbol = `hk` + code.padStart(5, '0');
    const url = `https://qt.gtimg.cn/q=${symbol}`;
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: TENCENT_HEADERS,
    });
    const text = new TextDecoder('gbk').decode(res.data);
    const match = text.match(/"([^"]*)"/);
    if (!match) {
      throw new Error('Invalid Tencent response format');
    }
    const fields = match[1].split('~');
    if (fields.length < 38) {
      throw new Error('Invalid Tencent fields data');
    }
    const name = fields[1];
    const price = parseFloat(fields[3]);
    const change_pct = parseFloat(fields[32]);
    const turnover = parseFloat(fields[37]);
    const volumeVal = parseFloat(fields[6]);
    const volume = isNaN(volumeVal) ? null : volumeVal;
    const turnoverRateVal = parseFloat(fields[38]);
    const turnover_rate = isNaN(turnoverRateVal) ? null : turnoverRateVal;
    const marketCapVal = parseFloat(fields[45]);
    const market_cap = isNaN(marketCapVal) ? null : Math.round(marketCapVal * 100000000);
    const peVal = parseFloat(fields[39]);
    const pe = isNaN(peVal) ? null : peVal;

    return {
      code,
      name,
      market: 'HK',
      price: isNaN(price) || price === 0 ? null : price,
      change_pct: isNaN(change_pct) ? null : change_pct,
      turnover: isNaN(turnover) ? null : turnover,
      volume,
      turnover_rate,
      market_cap,
      pe,
    };
  }

  private async getInfoHKSina(code: string): Promise<StockInfo> {
    const symbol = `hk` + code.padStart(5, '0');
    const url = `https://hq.sinajs.cn/list=${symbol}`;
    const res = await axios
      .get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 5000, headers: SINA_HEADERS })
      .catch((err: Error) => {
        throw new HttpException(
          `Failed to fetch HK stock info from both Tencent and Sina: ${err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      });
    const text = new TextDecoder('gbk').decode(res.data);
    const match = text.match(/"([^"]*)"/);
    if (!match) {
      throw new HttpException('Invalid Sina response format', HttpStatus.BAD_GATEWAY);
    }
    const csv = match[1];
    const r = csv.split(',');
    if (r.length < 10) {
      throw new HttpException('Invalid Sina csv data', HttpStatus.BAD_GATEWAY);
    }
    const name = r[1];
    const price = parseFloat(r[6]);
    const change_pct = parseFloat(r[8]);
    const turnover = parseFloat(r[11]);
    const volume = parseFloat(r[12]);

    return {
      code,
      name,
      market: 'HK',
      price: isNaN(price) || price === 0 ? null : price,
      change_pct: isNaN(change_pct) ? null : change_pct,
      turnover: isNaN(turnover) ? null : turnover,
      volume: isNaN(volume) ? null : volume,
      turnover_rate: null,
      market_cap: null,
      pe: null,
    };
  }
}
