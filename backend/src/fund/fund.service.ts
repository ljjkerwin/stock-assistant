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
  fundSize: string | null;
  establishDate: string | null;
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

export interface FundHolding {
  rank: number;
  code: string;
  name: string;
  latestPrice: number | null;
  marketValue: number | null;
}

export interface FundHoldingPeriod {
  period: string;
  endDate: string;
  holdings: FundHolding[];
}

interface EstimatedData {
  name?: string;
  gsz?: string;
  gszzl?: string;
  gztime?: string;
}

interface FundListItem {
  code: string;
  name: string;
  type: string;
}

@Injectable()
export class FundService {
  private infoCache = new MemCache<FundInfo>();
  private navCache = new MemCache<FundNavResponse>();
  private searchCache = new MemCache<FundSearchResult[]>();
  private holdingsCache = new MemCache<FundHoldingPeriod[]>();
  // 基金名称单独缓存，TTL 2h，避免 fundgz 抖动时反复丢失名称
  private nameCache = new MemCache<string>();

  private fundList: FundListItem[] | null = null;
  private fundListLoadedAt = 0;
  private readonly FUND_LIST_TTL = 24 * 60 * 60_000;

  private async loadFundList(): Promise<FundListItem[]> {
    if (this.fundList && Date.now() - this.fundListLoadedAt < this.FUND_LIST_TTL) {
      return this.fundList;
    }
    const res = await axios
      .get<string>('https://fund.eastmoney.com/js/fundcode_search.js', {
        headers: FUND_HEADERS,
        timeout: 15000,
        responseType: 'text',
      })
      .catch(() => null);
    if (!res?.data) return this.fundList ?? [];
    // strip UTF-8 BOM if present, then parse "var r = [...];"
    const raw = res.data
      .replace(/^\uFEFF/, '')
      .trim()
      .replace(/^var\s+r\s*=\s*/, '')
      .replace(/;?\s*$/, '');
    const parsed = JSON.parse(raw) as string[][];
    this.fundList = parsed.map(([code, , name, type]) => ({ code, name, type }));
    this.fundListLoadedAt = Date.now();
    return this.fundList;
  }

  async searchFunds(q: string): Promise<FundSearchResult[]> {
    if (!q.trim()) return [];
    const cacheKey = `search_${q}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const list = await this.loadFundList();
    const lower = q.toLowerCase();
    const results: FundSearchResult[] = list
      .filter((item) => item.code.includes(q) || item.name.toLowerCase().includes(lower))
      .slice(0, 10)
      .map((item) => ({ code: item.code, name: item.name, type: item.type }));

    this.searchCache.set(cacheKey, results, 5 * 60_000);
    return results;
  }

  async getFundInfo(code: string): Promise<FundInfo> {
    const cacheKey = `info_${code}`;
    const cached = this.infoCache.get(cacheKey);
    if (cached) return cached;

    const [lsjz, estimated, basicInfo] = await Promise.allSettled([
      this.fetchLsjz(code, 1, 1),
      this.fetchEstimated(code),
      this.fetchFundBasicInfo(code),
    ]);

    const lsjzData = lsjz.status === 'fulfilled' ? lsjz.value : null;
    const estimatedData = estimated.status === 'fulfilled' ? estimated.value : null;
    const basicInfoData = basicInfo.status === 'fulfilled' ? basicInfo.value : null;

    const latest = lsjzData?.LSJZList[0] ?? null;
    const resolvedName = estimatedData?.name ?? lsjzData?.Expansion ?? null;
    let name: string;
    if (resolvedName) {
      name = resolvedName;
      this.nameCache.set(code, name, 2 * 60 * 60_000);
    } else {
      // 优先用长效名称缓存，否则降级搜索一次
      const cached = this.nameCache.get(code);
      if (cached) {
        name = cached;
      } else {
        const results = await this.searchFunds(code).catch(() => [] as FundSearchResult[]);
        const match = results.find((r) => r.code === code);
        name = match?.name ?? code;
        if (match?.name) this.nameCache.set(code, name, 2 * 60 * 60_000);
      }
    }

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
      fundSize: basicInfoData?.fundSize ?? null,
      establishDate: basicInfoData?.establishDate ?? null,
    };

    this.infoCache.set(cacheKey, info, tradingTtl(30_000, 10 * 60_000));
    return info;
  }

  async getFundNav(code: string, limit: number): Promise<FundNavResponse> {
    const cacheKey = `nav_${code}_${limit}`;
    const cached = this.navCache.get(cacheKey);
    if (cached) return cached;

    // lsjz API 单页实际上限 20，超出时分页并发拉取
    const PAGE_SIZE = 20;
    const pages = Math.ceil(limit / PAGE_SIZE);
    const pageRequests = Array.from({ length: pages }, (_, i) =>
      this.fetchLsjz(code, i + 1, PAGE_SIZE),
    );
    const pageResults = await Promise.all(pageRequests);

    const allItems: LsjzItem[] = pageResults.flatMap((r) => r.LSJZList).slice(0, limit);
    const total = pageResults[0]?.TotalCount ?? 0;
    const expansion = pageResults[0]?.Expansion ?? null;

    const data: FundNavPoint[] = allItems
      .map((item) => ({
        date: item.FSRQ,
        nav: parseFloat(item.DWJZ),
        accNav: parseFloat(item.LJJZ),
        changePct: item.JZZZL ? parseFloat(item.JZZZL) : null,
      }))
      .reverse();

    const navName = expansion ?? this.nameCache.get(code) ?? code;
    const result: FundNavResponse = { code, name: navName, data, total };

    this.navCache.set(cacheKey, result, tradingTtl(60_000, 60 * 60_000));
    return result;
  }

  private async fetchLsjz(code: string, pageIndex: number, pageSize: number): Promise<LsjzResult> {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${pageIndex}&pageSize=${pageSize}`;
    const attempt = () =>
      axios.get<{
        Data?: { LSJZList?: LsjzItem[]; TotalCount?: number };
        Expansion?: string | null;
      }>(url, { headers: FUND_HEADERS, timeout: 8000 });
    const res = await attempt()
      .catch(() => attempt())
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

  async getFundHoldings(code: string): Promise<FundHoldingPeriod[]> {
    const cacheKey = `holdings_${code}`;
    const cached = this.holdingsCache.get(cacheKey);
    if (cached) return cached;

    const currentJs = await this.fetchHoldingsJs(code).catch(() => '');
    const currentPeriods = this.parseHoldingPeriods(currentJs);

    let result: FundHoldingPeriod[];
    if (currentPeriods.length >= 3) {
      result = currentPeriods.slice(0, 3);
    } else {
      const curYearMatch = /curyear:(\d+)/.exec(currentJs);
      const prevYear = curYearMatch ? parseInt(curYearMatch[1]) - 1 : new Date().getFullYear() - 1;
      const prevJs = await this.fetchHoldingsJs(code, prevYear).catch(() => '');
      const prevPeriods = this.parseHoldingPeriods(prevJs);
      result = [...currentPeriods, ...prevPeriods].slice(0, 3);
    }

    this.holdingsCache.set(cacheKey, result, 60 * 60_000);
    return result;
  }

  private async fetchHoldingsJs(code: string, year?: number): Promise<string> {
    const yearParam = year ? `&year=${year}` : '';
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10${yearParam}&month=&rt=${Math.random()}`;
    const res = await axios.get<string>(url, {
      headers: FUND_HEADERS,
      timeout: 8000,
      responseType: 'text',
    });
    return res.data;
  }

  private detectRatioIdx(block: string): number {
    // 从表头行（含"净值"文本的 <tr>）里找出占净值比例所在的列索引
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(block)) !== null) {
      if (!rowMatch[1].includes('净值')) continue;
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
      let cellMatch: RegExpExecArray | null;
      let idx = 0;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        if (cellMatch[1].replace(/<[^>]+>/g, '').includes('净值')) return idx;
        idx++;
      }
    }
    return -1;
  }

  private parseHoldingPeriods(jsText: string): FundHoldingPeriod[] {
    const contentMatch = /content:"([\s\S]*?)",\s*arryear:/.exec(jsText);
    if (!contentMatch) return [];
    const html = contentMatch[1];

    const blocks = html.split("<div class='boxitem w790'>").slice(1);
    const periods: FundHoldingPeriod[] = [];

    for (const block of blocks) {
      const periodMatch = /(\d{4}年\d+季度)/.exec(block);
      const period = periodMatch?.[1] ?? '';

      const dateMatch = /截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/.exec(block);
      const endDate = dateMatch?.[1] ?? '';

      // 从表头检测占净值比例所在列，不同季报格式各异
      const ratioIdx = this.detectRatioIdx(block);
      if (ratioIdx < 0) continue;

      const holdings: FundHolding[] = [];
      const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(block)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(cellMatch[1]);
        }
        if (cells.length <= ratioIdx) continue;

        const rank = parseInt(cells[0].replace(/<[^>]+>/g, '').trim());
        if (isNaN(rank) || rank < 1) continue;

        const codeMatch = /<a[^>]*>([^<]+)<\/a>/.exec(cells[1]);
        const stockCode = codeMatch?.[1]?.trim() ?? '';

        const nameMatch = /<a[^>]*>([^<]+)<\/a>/.exec(cells[2]);
        const name = nameMatch?.[1]?.trim() ?? '';

        const latestPriceStr = cells[3]?.replace(/<[^>]+>/g, '').trim() ?? '';
        const latestPrice = latestPriceStr ? parseFloat(latestPriceStr) || null : null;

        const marketValueStr = cells[ratioIdx]
          .replace(/<[^>]+>/g, '')
          .trim()
          .replace('%', '')
          .replace(/,/g, '');
        const marketValue = marketValueStr ? parseFloat(marketValueStr) || null : null;

        if (stockCode && name) {
          holdings.push({ rank, code: stockCode, name, latestPrice, marketValue });
        }
      }

      if (period && holdings.length > 0) {
        periods.push({ period, endDate, holdings });
      }
    }

    return periods;
  }

  private async fetchFundBasicInfo(
    code: string,
  ): Promise<{ fundSize: string | null; establishDate: string | null }> {
    const url = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
    const res = await axios
      .get<string>(url, { headers: FUND_HEADERS, timeout: 6000, responseType: 'text' })
      .catch(() => null);
    if (!res) return { fundSize: null, establishDate: null };

    const html = res.data;
    const dateMatch = /成立日期：<span>([\d-]+)<\/span>/.exec(html);
    const sizeMatch = /规模：<span>\s*([\d.]+亿元)/.exec(html);

    return {
      establishDate: dateMatch?.[1] ?? null,
      fundSize: sizeMatch?.[1] ?? null,
    };
  }

  private async fetchEstimated(code: string): Promise<EstimatedData> {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js`;
    const attempt = () =>
      axios.get<string>(url, {
        headers: { ...FUND_HEADERS, Referer: 'https://www.eastmoney.com/' },
        timeout: 5000,
        responseType: 'text',
      });
    const res = await attempt().catch(() => attempt());
    const text = res.data;
    const match = /jsonpgz\((\{.*?\})\)/s.exec(text);
    if (!match) throw new Error('无法解析实时估值响应');
    return JSON.parse(match[1]) as EstimatedData;
  }
}
