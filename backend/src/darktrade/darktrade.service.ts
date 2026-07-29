import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { DarkTradeIndex } from './dark-trade-index.entity';
import { DarkTradeSnapshot } from './dark-trade-snapshot.entity';
import { DarkTradeDailyResult } from './dark-trade-daily-result.entity';
import { Favorite } from '../favorites/favorite.entity';
import { Subscription } from 'rxjs';
import { SchedulerService } from '../scheduler/scheduler.service';
import { isTradingMarket } from '../cache';

const NUM_PER_PAGE = 30;
const CONCURRENCY = 5;
const BASE_URL = 'https://quotederivates.eastmoney.com/datacenter/darktrade';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Referer: 'https://data.eastmoney.com/',
};

// field "3": market (1=沪, 0=深); "4": code; "6": 暗盘资金(元); "7": 明盘资金(元);
// "8": 主力净流入含暗盘(元); "11": 暗盘活跃度(小数); "13": 最新价×1000;
// "14": 涨幅（小数，如 0.0188 表示 1.88%）; "16": 名称; "17": 行业; "18": 概念
interface RawItem {
  3: number;
  4: string;
  6: number;
  7: number;
  8: number;
  11: number;
  13: number;
  14: number;
  16: string;
  17: string;
  18: string;
  [key: string]: unknown;
}

interface RawResponse {
  errid: number;
  errmsg: string;
  1: number;
  2: number;
  data: RawItem[];
}

export interface DarkTradeData {
  code: string;
  name: string;
  latestPrice: number | null;
  changePct: number | null;
  darkCapital: number | null;
  lightCapital: number | null;
  netInflow: number | null;
  darkActivity: number | null;
  sector: string;
  concept: string;
  date: string;
}

export interface RefreshResult {
  indexed: number;
  date: string;
  pages: number;
}

export interface FetchAllDailySnapshotResult {
  date: string;
  total: number;
  written: number;
}

export const DISCOVERY_DEFAULT_MIN_DARK_CAPITAL = 20_000_000;
export const DISCOVERY_DEFAULT_MIN_MULTIPLE = 2;

function todayDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function nowBeijingMinutes(): number {
  const utc8 = new Date(Date.now() + 8 * 3600_000);
  return utc8.getUTCHours() * 60 + utc8.getUTCMinutes();
}

function captureMinuteForSnapshot(targetDate: string): string {
  const utc8 = new Date(Date.now() + 8 * 3600_000);
  const h = utc8.getUTCHours();
  const m = utc8.getUTCMinutes();
  return `${targetDate}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function cutoffDate(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  const utc8 = new Date(d.getTime() + 8 * 3600_000);
  const y = utc8.getUTCFullYear();
  const mo = String(utc8.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc8.getUTCDate()).padStart(2, '0');
  return `${y}${mo}${dd}`;
}

function minuteToDisplayTime(cm: string): string {
  return `${cm.slice(0, 4)}-${cm.slice(4, 6)}-${cm.slice(6, 8)} ${cm.slice(8, 10)}:${cm.slice(10, 12)}`;
}

@Injectable()
export class DarkTradeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DarkTradeService.name);
  private schedulerSubscription: Subscription | null = null;
  private cronSubscription: Subscription | null = null;
  private isPolling = false;
  private lastRefreshTime = 0;

  constructor(
    @InjectRepository(DarkTradeIndex)
    private readonly indexRepo: Repository<DarkTradeIndex>,
    @InjectRepository(DarkTradeSnapshot)
    private readonly snapshotRepo: Repository<DarkTradeSnapshot>,
    @InjectRepository(DarkTradeDailyResult)
    private readonly dailyResultRepo: Repository<DarkTradeDailyResult>,
    @InjectRepository(Favorite)
    private readonly favoriteRepo: Repository<Favorite>,
    private readonly schedulerService: SchedulerService,
  ) {}

  onModuleInit() {
    this.logger.log('已启动收藏夹暗盘数据轮询订阅（基于中央心跳，1分钟/次）');
    this.schedulerSubscription = this.schedulerService.tick$.subscribe(() => {
      // 每 1 个 tick (60s后) 触发一次
      void this.pollFavorites();
    });

    this.logger.log('已启动北京时间 09:28 定时重建暗盘数据索引订阅（仅限开盘日）');
    this.cronSubscription = this.schedulerService.minute$.subscribe((now) => {
      const hkt = new Date(now.getTime() + 8 * 3600 * 1000);
      const day = hkt.getUTCDay();
      const hour = hkt.getUTCHours();
      const minute = hkt.getUTCMinutes();

      // 仅限开盘日（工作日：周一至周五，day 1-5）
      if (day >= 1 && day <= 5) {
        if (hour === 9 && minute === 28) {
          this.logger.log('已到达北京时间 09:28（开盘日），开始定时重建暗盘数据索引...');
          void this.refreshIndex().catch((err) => {
            this.logger.error('定时重建暗盘数据索引失败', err);
          });
        }
      }
    });
  }

  onModuleDestroy() {
    if (this.schedulerSubscription) {
      this.schedulerSubscription.unsubscribe();
      this.schedulerSubscription = null;
    }
    if (this.cronSubscription) {
      this.cronSubscription.unsubscribe();
      this.cronSubscription = null;
    }
  }

  async pollFavorites() {
    if (this.isPolling) {
      this.logger.debug('[收藏夹轮询] 上次轮询未完成，跳过');
      return;
    }
    if (!isTradingMarket('A')) {
      this.logger.debug('[收藏夹轮询] 当前非 A 股开盘时间，跳过');
      return;
    }

    this.isPolling = true;
    try {
      this.logger.log('[收藏夹轮询] 开始获取收藏夹标的暗盘数据...');
      const favorites = await this.favoriteRepo.find({
        where: { market: 'A' },
        select: ['code'],
      });
      const codes = [...new Set(favorites.map((f) => f.code))];
      if (codes.length === 0) {
        this.logger.log('[收藏夹轮询] 没有 A 股收藏标的，跳过');
        return;
      }
      this.logger.log(
        `[收藏夹轮询] 共找到 ${codes.length} 个去重 A 股收藏标的: ${codes.join(', ')}`,
      );
      await this.getBatchDarkTrade(codes);
      this.logger.log('[收藏夹轮询] 成功更新收藏夹标的暗盘数据及快照');
    } catch (err) {
      this.logger.error('[收藏夹轮询] 获取暗盘数据失败', err);
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchPage(
    page: number,
    date: string,
    sortFlag: number,
    desc: number,
  ): Promise<RawResponse> {
    const url = `${BASE_URL}?version=100&cver=100&date=${date}&StartPage=${page}&NumPerPage=${NUM_PER_PAGE}&sortflag=${sortFlag}&desc=${desc}&market=&datetype=`;
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: HEADERS,
    });
    const text = new TextDecoder('gbk').decode(res.data);
    return JSON.parse(text) as RawResponse;
  }

  async refreshIndex(date?: string, sortFlag = 4, desc = 1): Promise<RefreshResult> {
    const targetDate = date ?? todayDate();

    const firstPage = await this.fetchPage(1, targetDate, sortFlag, desc);
    if (firstPage.errid !== 0) {
      throw new Error(`暗盘接口返回错误: ${firstPage.errmsg}`);
    }

    const total = firstPage[2];
    const totalPages = Math.ceil(total / NUM_PER_PAGE);
    this.logger.log(`开始建立暗盘索引: date=${targetDate} total=${total} pages=${totalPages}`);

    // code → { pageNum, indexInPage, item }
    const mapping = new Map<string, { pageNum: number; indexInPage: number; item: RawItem }>();

    firstPage.data.forEach((item, idx) => {
      if (item[4]) mapping.set(item[4], { pageNum: 1, indexInPage: idx, item });
    });

    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < remaining.length; i += CONCURRENCY) {
      const batch = remaining.slice(i, i + CONCURRENCY);
      const pages = await Promise.all(
        batch.map((p) => this.fetchPage(p, targetDate, sortFlag, desc)),
      );
      for (let j = 0; j < pages.length; j++) {
        const pageNum = batch[j];
        pages[j].data.forEach((item, idx) => {
          if (item[4]) mapping.set(item[4], { pageNum, indexInPage: idx, item });
        });
      }
      if ((i / CONCURRENCY + 1) % 10 === 0) {
        this.logger.log(`进度: ${Math.min(i + CONCURRENCY + 1, totalPages)}/${totalPages} 页`);
      }
    }

    await this.indexRepo.clear();

    const entities: Partial<DarkTradeIndex>[] = Array.from(mapping.entries()).map(
      ([code, { pageNum, indexInPage, item }]) => ({
        code,
        pageNum,
        indexInPage,
        refreshDate: targetDate,
        sortFlag,
        sortDesc: desc,
        name: item[16] ?? null,
        latestPrice: item[13] != null ? item[13] / 1000 : null,
        changePct: item[14] != null ? item[14] : null,
        darkCapital: item[6] != null ? item[6] : null,
        lightCapital: item[7] != null ? item[7] : null,
        netInflow: item[8] != null ? item[8] : null,
        darkActivity: item[11] != null ? item[11] : null,
        sector: item[17] ?? null,
        concept: item[18] ?? null,
      }),
    );

    const CHUNK = 500;
    for (let i = 0; i < entities.length; i += CHUNK) {
      await this.indexRepo.insert(entities.slice(i, i + CHUNK));
    }

    await this.writeFullMarketSnapshot(entities, targetDate);

    this.logger.log(`暗盘索引建立完成: ${mapping.size} 只股票`);
    this.lastRefreshTime = Date.now();
    return { indexed: mapping.size, date: targetDate, pages: totalPages };
  }

  async getDarkTrade(code: string): Promise<DarkTradeData> {
    const index = await this.indexRepo.findOne({ where: { code } });
    if (!index) {
      throw new NotFoundException(`股票 ${code} 不在暗盘索引中，请先调用 refresh-index`);
    }
    return this.entityToData(index);
  }

  /**
   * 返回暗盘资金显著高于明盘资金的全市场标的。
   * 每只股票使用指定日期最后一条全市场快照，按暗盘资金从高到低排列。
   */
  async getDiscoveryStocks(
    minDarkCapital = DISCOVERY_DEFAULT_MIN_DARK_CAPITAL,
    minMultiple = DISCOVERY_DEFAULT_MIN_MULTIPLE,
    date = todayDate(),
  ): Promise<DarkTradeData[]> {
    let results = await this.dailyResultRepo.find({ where: { tradeDate: date } });
    // 兼容上线前已有的分钟/日终快照：首次访问某日时回填结果表，之后查询不再扫描快照表。
    if (results.length === 0) {
      const snapshots = await this.getLatestSnapshotsForDate(date);
      await this.upsertDailyResults(snapshots);
      results = await this.dailyResultRepo.find({ where: { tradeDate: date } });
    }
    // 兼容升级前已建立但尚未写入快照的当日索引：先补一份全市场快照，再统一从快照读取。
    if (results.length === 0 && date === todayDate()) {
      const entries = await this.indexRepo.find({ where: { refreshDate: date } });
      await this.writeFullMarketSnapshot(entries, date);
      results = await this.dailyResultRepo.find({ where: { tradeDate: date } });
    }

    return results
      .filter(
        (item) =>
          item.darkCapital != null &&
          item.lightCapital != null &&
          item.darkCapital > minDarkCapital &&
          item.darkCapital > Math.abs(item.lightCapital) * minMultiple,
      )
      .sort((a, b) => (b.darkCapital ?? 0) - (a.darkCapital ?? 0))
      .map((item) => this.dailyResultToData(item));
  }

  private async upsertDailyResults(
    snapshots: Array<
      Pick<
        DarkTradeSnapshot,
        | 'tradeDate'
        | 'code'
        | 'captureMinute'
        | 'darkCapital'
        | 'lightCapital'
        | 'name'
        | 'latestPrice'
        | 'changePct'
        | 'netInflow'
        | 'darkActivity'
        | 'sector'
        | 'concept'
      >
    >,
  ): Promise<void> {
    if (snapshots.length === 0) return;
    await this.dailyResultRepo.upsert(
      snapshots.map((snapshot) => ({
        tradeDate: snapshot.tradeDate,
        code: snapshot.code,
        captureMinute: snapshot.captureMinute,
        darkCapital: snapshot.darkCapital,
        lightCapital: snapshot.lightCapital,
        name: snapshot.name,
        latestPrice: snapshot.latestPrice,
        changePct: snapshot.changePct,
        netInflow: snapshot.netInflow,
        darkActivity: snapshot.darkActivity,
        sector: snapshot.sector,
        concept: snapshot.concept,
      })),
      ['tradeDate', 'code'],
    );
  }

  /**
   * 由数据库按股票代码取指定日期的最大 captureMinute。
   * 不能把一天内所有分钟快照读入内存，否则多用户积累后会造成大查询和高内存占用。
   */
  private getLatestSnapshotsForDate(date: string): Promise<DarkTradeSnapshot[]> {
    return this.snapshotRepo
      .createQueryBuilder('snapshot')
      .where('snapshot.trade_date = :date', { date })
      .andWhere(
        `snapshot.capture_minute = (
          SELECT MAX(latest_snapshot.capture_minute)
          FROM dark_trade_snapshot latest_snapshot
          WHERE latest_snapshot.code = snapshot.code
            AND latest_snapshot.trade_date = :date
        )`,
        { date },
      )
      .getMany();
  }

  private async writeFullMarketSnapshot(
    entries: Partial<DarkTradeIndex>[],
    date: string,
  ): Promise<void> {
    const captureMinute =
      date === todayDate() && nowBeijingMinutes() < 15 * 60
        ? captureMinuteForSnapshot(date)
        : `${date}1500`;
    const snapshots = entries
      .filter((entry) => entry.darkCapital != null || entry.lightCapital != null)
      .map((entry) => ({
        code: entry.code!,
        tradeDate: date,
        captureMinute,
        darkCapital: entry.darkCapital ?? null,
        lightCapital: entry.lightCapital ?? null,
        name: entry.name ?? null,
        latestPrice: entry.latestPrice ?? null,
        changePct: entry.changePct ?? null,
        netInflow: entry.netInflow ?? null,
        darkActivity: entry.darkActivity ?? null,
        sector: entry.sector ?? null,
        concept: entry.concept ?? null,
      }));
    if (snapshots.length === 0) return;

    await this.snapshotRepo
      .createQueryBuilder()
      .insert()
      .into(DarkTradeSnapshot)
      .values(snapshots)
      .orUpdate(
        [
          'dark_capital',
          'light_capital',
          'name',
          'latest_price',
          'change_pct',
          'net_inflow',
          'dark_activity',
          'sector',
          'concept',
          'trade_date',
        ],
        ['code', 'capture_minute'],
      )
      .updateEntity(false)
      .execute();
    await this.upsertDailyResults(snapshots);
  }

  private refreshLock: Promise<void> | null = null;

  // 1 分钟短缓存，避免同分钟内对上游重复请求（key = `${code}:${date}`）
  private readonly freshCache = new Map<string, { expireAt: number; data: DarkTradeData }>();

  /**
   * 按 code 查出 pageNum，只拉取包含目标 code 的页，从上游取最新数据。
   * 同分钟内命中短缓存则跳过请求；未在页中找到的 code（排名变动）返回 map 中不含该 code。
   */
  private async fetchFreshForCodes(
    codes: string[],
    date: string,
  ): Promise<Map<string, DarkTradeData>> {
    const now = Date.now();
    const result = new Map<string, DarkTradeData>();
    const toFetch: string[] = [];

    for (const code of codes) {
      const cached = this.freshCache.get(`${code}:${date}`);
      if (cached && cached.expireAt > now) {
        result.set(code, cached.data);
      } else {
        toFetch.push(code);
      }
    }
    if (toFetch.length === 0) return result;

    const indices = await this.indexRepo.find({ where: { code: In(toFetch) } });
    if (indices.length === 0) return result;

    const { sortFlag, sortDesc } = indices[0];
    const pageNums = [...new Set(indices.map((i) => i.pageNum))].sort((a, b) => a - b);
    const targetCodes = new Set(toFetch);

    for (let i = 0; i < pageNums.length; i += CONCURRENCY) {
      const batch = pageNums.slice(i, i + CONCURRENCY);
      const pages = await Promise.allSettled(
        batch.map((p) => this.fetchPage(p, date, sortFlag, sortDesc)),
      );
      for (const pr of pages) {
        if (pr.status !== 'fulfilled') continue;
        for (const item of pr.value.data ?? []) {
          const code = item[4];
          if (!code || !targetCodes.has(code)) continue;
          const data: DarkTradeData = {
            code,
            name: item[16] ?? '',
            latestPrice: item[13] != null ? item[13] / 1000 : null,
            changePct: item[14] ?? null,
            darkCapital: item[6] ?? null,
            lightCapital: item[7] ?? null,
            netInflow: item[8] ?? null,
            darkActivity: item[11] ?? null,
            sector: item[17] ?? '',
            concept: item[18] ?? '',
            date,
          };
          result.set(code, data);
          this.freshCache.set(`${code}:${date}`, { data, expireAt: now + 60_000 });
          targetCodes.delete(code);
        }
      }
    }

    return result;
  }

  async getBatchDarkTrade(codes: string[], date?: string): Promise<Record<string, DarkTradeData>> {
    if (codes.length === 0) return {};

    const targetDate = date ?? todayDate();
    const status = await this.getIndexStatus();
    if (status.date !== targetDate) {
      if (!this.refreshLock) {
        this.refreshLock = this.refreshIndex(targetDate)
          .then(() => undefined)
          .finally(() => {
            this.refreshLock = null;
          });
      }
      try {
        await this.refreshLock;
      } catch {
        this.logger.warn(`暗盘索引自动刷新失败（date=${targetDate}），继续使用旧索引`);
      }
    }

    // 从上游拉取最新数据（1 分钟内重复调用命中短缓存）
    const freshData = await this.fetchFreshForCodes(codes, targetDate);

    // 找不到的 code（排名大幅变动）回退读取静态索引
    const missing = codes.filter((c) => !freshData.has(c));
    if (missing.length > 0) {
      const fallback = await this.indexRepo.find({ where: { code: In(missing) } });

      const now = Date.now();
      if (fallback.length > 0 && now - this.lastRefreshTime > 5 * 60 * 1000) {
        this.logger.log(
          `检测到 ${fallback.length} 只股票已从索引页面飘移（如 ${fallback.map((f) => f.code).join(', ')}），触发索引重建...`,
        );
        try {
          await this.refreshIndex(targetDate);
          const refetchedData = await this.fetchFreshForCodes(codes, targetDate);
          for (const [c, d] of refetchedData.entries()) {
            freshData.set(c, d);
          }
          const newMissing = codes.filter((c) => !freshData.has(c));
          if (newMissing.length > 0) {
            const newFallback = await this.indexRepo.find({ where: { code: In(newMissing) } });
            for (const idx of newFallback) {
              freshData.set(idx.code, this.entityToData(idx));
            }
          }
        } catch (err) {
          this.logger.warn('飘移后重建索引或二次拉取失败', err);
          for (const idx of fallback) {
            freshData.set(idx.code, this.entityToData(idx));
          }
        }
      } else {
        for (const idx of fallback) {
          freshData.set(idx.code, this.entityToData(idx));
        }
      }
    }

    if (freshData.size === 0) return {};

    const result: Record<string, DarkTradeData> = Object.fromEntries(freshData);

    // 交易时段（09:30–15:00）按当前分钟写快照；收盘后（≥15:00）源数据已为当日收盘终值，
    // 补写为 15:00 收盘快照（242 槽位轴的最后一槽），开盘前（<09:30）跳过
    const minsNow = nowBeijingMinutes();
    const inTradingHours = minsNow >= 9 * 60 + 30 && minsNow < 15 * 60;
    const afterClose = minsNow >= 15 * 60;
    if (inTradingHours || afterClose) {
      let minute: string;
      if (afterClose) {
        minute = `${targetDate}1500`;
      } else if (minsNow > 11 * 60 + 30 && minsNow <= 13 * 60) {
        // 中午休息时间（11:30 - 13:00）的暗盘资金，算作是 11:30 的数据
        minute = `${targetDate}1130`;
      } else {
        minute = captureMinuteForSnapshot(targetDate);
      }
      const snapshotEntities = Object.values(result)
        .filter((d) => d.darkCapital != null || d.lightCapital != null)
        .map((d) => ({
          code: d.code,
          tradeDate: targetDate,
          captureMinute: minute,
          darkCapital: d.darkCapital,
          lightCapital: d.lightCapital,
          name: d.name,
          latestPrice: d.latestPrice,
          changePct: d.changePct,
          netInflow: d.netInflow,
          darkActivity: d.darkActivity,
          sector: d.sector,
          concept: d.concept,
        }));
      if (snapshotEntities.length > 0) {
        await this.snapshotRepo
          .createQueryBuilder()
          .insert()
          .into(DarkTradeSnapshot)
          .values(snapshotEntities)
          .orUpdate(
            [
              'dark_capital',
              'light_capital',
              'name',
              'latest_price',
              'change_pct',
              'net_inflow',
              'dark_activity',
              'sector',
              'concept',
              'trade_date',
            ],
            ['code', 'capture_minute'],
          )
          .updateEntity(false)
          .execute();
        await this.upsertDailyResults(snapshotEntities);
      }
    }

    return result;
  }

  /** 单股快照（StockDetail 用）：每天取最后一条，返回日线粒度 */
  async getSnapshots(
    code: string,
    days = 60,
  ): Promise<{ time: string; darkCapital: number | null; lightCapital: number | null }[]> {
    const cutoff = cutoffDate(days);
    const rows = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.code = :code', { code })
      .andWhere('s.trade_date >= :cutoff', { cutoff })
      .orderBy('s.capture_minute', 'ASC')
      .getMany();

    // 过滤开盘前（09:30 之前）的快照，每天取最后一条（captureMinute 最大）
    const byDay = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
      if (r.captureMinute.slice(8) < '0930') continue;
      byDay.set(r.tradeDate, r);
    }
    const currentDate = todayDate();
    const beforeClose = nowBeijingMinutes() < 15 * 60;
    return (
      Array.from(byDay.values())
        // 历史日期只使用收盘快照；当日尚未收盘时，以最新盘中快照补作当日数据。
        .filter(
          (r) => r.captureMinute.endsWith('1500') || (r.tradeDate === currentDate && beforeClose),
        )
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
        .map((r) => ({
          time: `${r.tradeDate.slice(0, 4)}-${r.tradeDate.slice(4, 6)}-${r.tradeDate.slice(6, 8)}`,
          darkCapital: r.darkCapital,
          lightCapital: r.lightCapital,
        }))
    );
  }

  /** 批量快照（StockListKline 用）：分钟粒度，返回 code→记录[]；date=YYYYMMDD 时只取当天 */
  async getSnapshotsBatch(
    codes: string[],
    date?: string,
  ): Promise<
    Record<string, { time: string; darkCapital: number | null; lightCapital: number | null }[]>
  > {
    if (codes.length === 0) return {};

    const targetDate = date ?? todayDate();
    const status = await this.getIndexStatus();
    if (status.date !== targetDate) {
      if (!this.refreshLock) {
        this.refreshLock = this.refreshIndex(targetDate)
          .then(() => undefined)
          .finally(() => {
            this.refreshLock = null;
          });
      }
      try {
        await this.refreshLock;
      } catch {
        this.logger.warn(`暗盘索引自动刷新失败（date=${targetDate}），继续使用旧索引`);
      }
    }

    // 如果查询的是今天，则在获取快照前，先触发一次最新数据的拉取与快照写入
    if (targetDate === todayDate()) {
      try {
        await this.getBatchDarkTrade(codes, targetDate);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`获取实时暗盘数据并生成快照失败 (codes=${codes.join(',')}): ${msg}`);
      }
    }

    const qb = this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.code IN (:...codes)', { codes })
      .orderBy('s.capture_minute', 'ASC');
    if (date) {
      qb.andWhere('s.trade_date = :date', { date });
    } else {
      qb.andWhere('s.trade_date >= :cutoff', { cutoff: cutoffDate(30) });
    }
    const rows = await qb.getMany();

    const result: Record<
      string,
      { time: string; darkCapital: number | null; lightCapital: number | null }[]
    > = {};
    // 过滤开盘前（09:30 之前）的快照，并按 (code, captureMinute) 去重
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.captureMinute.slice(8) < '0930') continue;
      const key = `${r.code}:${r.captureMinute}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!result[r.code]) result[r.code] = [];
      result[r.code].push({
        time: minuteToDisplayTime(r.captureMinute),
        darkCapital: r.darkCapital,
        lightCapital: r.lightCapital,
      });
    }
    return result;
  }

  /**
   * 抓取指定日期全市场（约 5300 只）的明暗盘收盘数据并写入快照表。
   * 步骤：
   *   1. refreshIndex(date) — 爬取所有页（约 177 页），建全量索引
   *   2. 读取该日期全量 index 记录，批量写 captureMinute=${date}1500 快照（幂等）
   */
  async fetchAllDailySnapshot(date: string): Promise<FetchAllDailySnapshotResult> {
    this.logger.log(`[全市场快照] 开始抓取 ${date} 全量明暗盘数据...`);

    // 1. 重建该日期索引（全量爬取）
    const { indexed } = await this.refreshIndex(date);

    // 2. 读取本次建立的全量 index（以 refreshDate 过滤，防止读到其他日期残留数据）
    const allEntries = await this.indexRepo.find({ where: { refreshDate: date } });
    this.logger.log(
      `[全市场快照] 索引完成，共 ${allEntries.length} 只股票，开始写入 ${date}1500 快照...`,
    );

    const captureMinute = `${date}1500`;
    const snapshotEntities = allEntries
      .filter((e) => e.darkCapital != null || e.lightCapital != null)
      .map((e) => ({
        code: e.code,
        tradeDate: date,
        captureMinute,
        darkCapital: e.darkCapital,
        lightCapital: e.lightCapital,
        name: e.name,
        latestPrice: e.latestPrice,
        changePct: e.changePct,
        netInflow: e.netInflow,
        darkActivity: e.darkActivity,
        sector: e.sector,
        concept: e.concept,
      }));

    const CHUNK = 500;
    let written = 0;
    for (let i = 0; i < snapshotEntities.length; i += CHUNK) {
      const chunk = snapshotEntities.slice(i, i + CHUNK);
      await this.snapshotRepo
        .createQueryBuilder()
        .insert()
        .into(DarkTradeSnapshot)
        .values(chunk)
        .orUpdate(
          [
            'dark_capital',
            'light_capital',
            'name',
            'latest_price',
            'change_pct',
            'net_inflow',
            'dark_activity',
            'sector',
            'concept',
            'trade_date',
          ],
          ['code', 'capture_minute'],
        )
        .updateEntity(false)
        .execute();
      await this.upsertDailyResults(chunk);
      written += chunk.length;
      this.logger.log(`[全市场快照] 已写入 ${written}/${snapshotEntities.length}`);
    }

    this.logger.log(`[全市场快照] 完成：date=${date}, indexed=${indexed}, written=${written}`);
    return { date, total: indexed, written };
  }

  async getIndexStatus(): Promise<{ count: number; date: string | null; updatedAt: Date | null }> {
    const count = await this.indexRepo.count();
    if (count === 0) return { count: 0, date: null, updatedAt: null };
    const latest = await this.indexRepo.findOne({ where: {}, order: { updatedAt: 'DESC' } });
    return { count, date: latest?.refreshDate ?? null, updatedAt: latest?.updatedAt ?? null };
  }

  private entityToData(entity: DarkTradeIndex): DarkTradeData {
    return {
      code: entity.code,
      name: entity.name ?? '',
      latestPrice: entity.latestPrice,
      changePct: entity.changePct,
      darkCapital: entity.darkCapital,
      lightCapital: entity.lightCapital,
      netInflow: entity.netInflow,
      darkActivity: entity.darkActivity,
      sector: entity.sector ?? '',
      concept: entity.concept ?? '',
      date: entity.refreshDate,
    };
  }

  private snapshotToData(snapshot: DarkTradeSnapshot): DarkTradeData {
    return {
      code: snapshot.code,
      name: snapshot.name ?? '',
      latestPrice: snapshot.latestPrice,
      changePct: snapshot.changePct,
      darkCapital: snapshot.darkCapital,
      lightCapital: snapshot.lightCapital,
      netInflow: snapshot.netInflow,
      darkActivity: snapshot.darkActivity,
      sector: snapshot.sector ?? '',
      concept: snapshot.concept ?? '',
      date: snapshot.tradeDate,
    };
  }

  private dailyResultToData(result: DarkTradeDailyResult): DarkTradeData {
    return {
      code: result.code,
      name: result.name ?? '',
      latestPrice: result.latestPrice,
      changePct: result.changePct,
      darkCapital: result.darkCapital,
      lightCapital: result.lightCapital,
      netInflow: result.netInflow,
      darkActivity: result.darkActivity,
      sector: result.sector ?? '',
      concept: result.concept ?? '',
      date: result.tradeDate,
    };
  }
}
