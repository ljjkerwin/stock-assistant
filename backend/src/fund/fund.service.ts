import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { MemCache, tradingTtl } from '../cache';

const FUND_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Referer: 'https://fundf10.eastmoney.com/',
};

export interface FundInfo {
  code: string;
  name: string;
  nav: number | null;
  accNav: number | null;
  navDate: string | null;
  estimatedNav: number | null;
  estimatedChangePct: number | null;
  estimatedTime: string | null;
  dailyChangePct: number | null;
}

export interface FundNavPoint {
  date: string;
  nav: number;
  accNav: number;
  changePct: number | null;
}

export interface FundNavResponse {
  code: string;
  name: string;
  data: FundNavPoint[];
  total: number;
}

interface LsjzItem {
  FSRQ: string;
  DWJZ: string;
  LJJZ: string;
  JZZZL?: string;
}

interface LsjzResult {
  LSJZList: LsjzItem[];
  TotalCount: number;
  Expansion: string | null;
}

export interface FundSearchResult {
  code: string;
  name: string;
  type: string;
}

interface EstimatedData {
  name?: string;
  gsz?: string;
  gszzl?: string;
  gztime?: string;
}

interface FundSuggestItem {
  CODE?: string;
  NAME?: string;
  FundType?: string;
}

@Injectable()
export class FundService {
  private infoCache = new MemCache<FundInfo>();
  private navCache = new MemCache<FundNavResponse>();
  private searchCache = new MemCache<FundSearchResult[]>();

  async searchFunds(q: string): Promise<FundSearchResult[]> {
    if (!q.trim()) return [];
    const cacheKey = `search_${q}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchPageAPI.ashx?m=1&key=${encodeURIComponent(q)}&n=10`;
    const res = await axios
      .get<{ Datas?: FundSuggestItem[]; ErrCode?: number }>(url, {
        headers: FUND_HEADERS,
        timeout: 5000,
      })
      .catch(() => null);

    const list: FundSearchResult[] = (res?.data?.Datas ?? [])
      .filter((item) => item.CODE && item.NAME)
      .map((item) => ({
        code: item.CODE!,
        name: item.NAME!,
        type: item.FundType ?? '',
      }));

    this.searchCache.set(cacheKey, list, 5 * 60_000);
    return list;
  }

  async getFundInfo(code: string): Promise<FundInfo> {
    const cacheKey = `info_${code}`;
    const cached = this.infoCache.get(cacheKey);
    if (cached) return cached;

    const [lsjz, estimated] = await Promise.allSettled([
      this.fetchLsjz(code, 1, 1),
      this.fetchEstimated(code),
    ]);

    const lsjzData = lsjz.status === 'fulfilled' ? lsjz.value : null;
    const estimatedData = estimated.status === 'fulfilled' ? estimated.value : null;

    const latest = lsjzData?.LSJZList[0] ?? null;
    const name = estimatedData?.name ?? lsjzData?.Expansion ?? code;

    const info: FundInfo = {
      code,
      name,
      nav: latest ? parseFloat(latest.DWJZ) : null,
      accNav: latest ? parseFloat(latest.LJJZ) : null,
      navDate: latest?.FSRQ ?? null,
      estimatedNav: estimatedData?.gsz ? parseFloat(estimatedData.gsz) : null,
      estimatedChangePct: estimatedData?.gszzl ? parseFloat(estimatedData.gszzl) : null,
      estimatedTime: estimatedData?.gztime ?? null,
      dailyChangePct: latest?.JZZZL ? parseFloat(latest.JZZZL) : null,
    };

    this.infoCache.set(cacheKey, info, tradingTtl(30_000, 10 * 60_000));
    return info;
  }

  async getFundNav(code: string, limit: number): Promise<FundNavResponse> {
    const cacheKey = `nav_${code}_${limit}`;
    const cached = this.navCache.get(cacheKey);
    if (cached) return cached;

    const lsjz = await this.fetchLsjz(code, 1, limit);

    const data: FundNavPoint[] = lsjz.LSJZList.map((item) => ({
      date: item.FSRQ,
      nav: parseFloat(item.DWJZ),
      accNav: parseFloat(item.LJJZ),
      changePct: item.JZZZL ? parseFloat(item.JZZZL) : null,
    })).reverse();

    const result: FundNavResponse = {
      code,
      name: lsjz.Expansion ?? code,
      data,
      total: lsjz.TotalCount,
    };

    this.navCache.set(cacheKey, result, tradingTtl(60_000, 60 * 60_000));
    return result;
  }

  private async fetchLsjz(code: string, pageIndex: number, pageSize: number): Promise<LsjzResult> {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${pageIndex}&pageSize=${pageSize}`;
    const res = await axios
      .get<{
        Data?: { LSJZList?: LsjzItem[]; TotalCount?: number };
        Expansion?: string | null;
      }>(url, { headers: FUND_HEADERS, timeout: 8000 })
      .catch((err: Error) => {
        throw new HttpException(`基金净值获取失败: ${err.message}`, HttpStatus.BAD_GATEWAY);
      });

    const data = res.data?.Data;
    if (!data) throw new HttpException('基金净值数据格式异常', HttpStatus.BAD_GATEWAY);

    return {
      LSJZList: data.LSJZList ?? [],
      TotalCount: data.TotalCount ?? 0,
      Expansion: res.data?.Expansion ?? null,
    };
  }

  private async fetchEstimated(code: string): Promise<EstimatedData> {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js`;
    const res = await axios.get<string>(url, {
      headers: { ...FUND_HEADERS, Referer: 'https://www.eastmoney.com/' },
      timeout: 5000,
      responseType: 'text',
    });
    const text = res.data;
    const match = /jsonpgz\((\{.*?\})\)/s.exec(text);
    if (!match) throw new Error('无法解析实时估值响应');
    return JSON.parse(match[1]) as EstimatedData;
  }
}
