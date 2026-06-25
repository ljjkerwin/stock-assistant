import axios from 'axios';
import type {
  Stock,
  StockInfo,
  KlineResponse,
  KlinePeriod,
  KlineBar,
  MonitorRule,
  MonitorMessage,
  FundInfo,
  FundNavResponse,
  FundSearchResult,
  FundHoldingPeriod,
  WatchList,
  BoardType,
  DarkTradeData,
  DarkTradeSnapshot,
} from '../types';

const api = axios.create({ baseURL: '/api' });

export const favoritesApi = {
  list: (watchListId: number) =>
    api.get<Stock[]>('/favorites', { params: { watchListId } }).then((r) => r.data),
  add: (stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string; watchListId: number }) =>
    api.post<Stock>('/favorites', stock).then((r) => r.data),
  remove: (id: number) => api.delete(`/favorites/${id}`),
  update: (id: number, data: { sortOrder?: number; pinned?: boolean }) =>
    api.patch<Stock>(`/favorites/${id}`, data).then((r) => r.data),
};

export const watchListsApi = {
  list: (boardType: BoardType): Promise<WatchList[]> =>
    api.get<WatchList[]>('/watchlists', { params: { boardType } }).then((r) => r.data),
  create: (name: string, boardType: BoardType): Promise<WatchList> =>
    api.post<WatchList>('/watchlists', { name, boardType }).then((r) => r.data),
  remove: (id: number): Promise<void> => api.delete(`/watchlists/${id}`).then(() => undefined),
};

export const stocksApi = {
  search: (q: string) =>
    api.get<Stock[]>('/stocks/search', { params: { q } }).then((r) => r.data),

  getInfo: (market: 'A' | 'HK', code: string): Promise<StockInfo> =>
    api.get<StockInfo>(`/stocks/${market}/${code}`).then((r) => r.data),
};

export const klineApi = {
  get: (market: 'A' | 'HK', code: string, period: KlinePeriod): Promise<KlineResponse> =>
    api.get<KlineResponse>(`/kline/${market}/${code}`, { params: { period } }).then((r) => r.data),
};

export const fundApi = {
  search: (q: string): Promise<FundSearchResult[]> =>
    api.get<FundSearchResult[]>('/fund/search', { params: { q } }).then((r) => r.data),

  getInfo: (code: string): Promise<FundInfo> =>
    api.get<FundInfo>(`/fund/${code}`).then((r) => r.data),

  getNav: (code: string, limit: number): Promise<FundNavResponse> =>
    api.get<FundNavResponse>(`/fund/${code}/nav`, { params: { limit } }).then((r) => r.data),

  getHoldings: (code: string): Promise<FundHoldingPeriod[]> =>
    api.get<FundHoldingPeriod[]>(`/fund/${code}/holdings`).then((r) => r.data),
};

export const monitorApi = {
  getRules: (): Promise<MonitorRule[]> =>
    api.get<MonitorRule[]>('/monitor/rules').then((r) => r.data),

  createRule: (body: {
    stockCode: string;
    stockMarket: 'A' | 'HK';
    stockName: string;
    type: string;
    targetPrice?: number;
    maPeriod?: string;
    klinePeriod?: string;
  }): Promise<MonitorRule> =>
    api.post<MonitorRule>('/monitor/rules', body).then((r) => r.data),

  deleteRule: (id: number): Promise<void> =>
    api.delete(`/monitor/rules/${id}`).then(() => undefined),

  toggleRule: (id: number, active: boolean): Promise<MonitorRule> =>
    api.patch<MonitorRule>(`/monitor/rules/${id}`, { active }).then((r) => r.data),

  getMessages: (page: number): Promise<{ items: MonitorMessage[]; total: number }> =>
    api
      .get<{ items: MonitorMessage[]; total: number }>('/monitor/messages', { params: { page } })
      .then((r) => r.data),

  getUnreadCount: (): Promise<{ count: number }> =>
    api.get<{ count: number }>('/monitor/messages/unread-count').then((r) => r.data),

  markMessagesRead: (ids: number[]): Promise<void> =>
    api.patch('/monitor/messages', { ids }).then(() => undefined),

  clearMessages: (): Promise<void> =>
    api.delete('/monitor/messages').then(() => undefined),
};

interface TradeRecord {
  type: 'buy' | 'sell';
  time: string;
  price: number;
  reason: string;
  profit?: number;
}

interface BacktestResult {
  priceChangePercent: number;
  returnPercent: number;
  maxDrawdown: number;
  sharpeRatio: number;
  tradeCount: number;
  trades: TradeRecord[];
  klines: KlineBar[];
  backtestStartTime?: string | null;
}

export const darktradeApi = {
  get: (code: string): Promise<DarkTradeData | null> =>
    api
      .get<DarkTradeData>(`/darktrade/${code}`)
      .then((r) => r.data)
      .catch(() => null),

  getBatch: (codes: string[], date?: string): Promise<Record<string, DarkTradeData>> =>
    codes.length === 0
      ? Promise.resolve({})
      : api
          .get<Record<string, DarkTradeData>>('/darktrade/batch', {
            params: { codes: codes.join(','), ...(date ? { date } : {}) },
          })
          .then((r) => r.data)
          .catch(() => ({})),

  getSnapshots: (code: string, days = 60): Promise<DarkTradeSnapshot[]> =>
    api
      .get<DarkTradeSnapshot[]>(`/darktrade/snapshots/${code}`, { params: { days } })
      .then((r) => r.data)
      .catch(() => []),

  getSnapshotsBatch: (codes: string[], days = 30): Promise<Record<string, DarkTradeSnapshot[]>> =>
    codes.length === 0
      ? Promise.resolve({})
      : api
          .get<Record<string, DarkTradeSnapshot[]>>('/darktrade/snapshots-batch', {
            params: { codes: codes.join(','), days },
          })
          .then((r) => r.data)
          .catch(() => ({})),
};

export const strategyApi = {
  // 策略清单：稳定 id + 展示名称。回测以 id 标识策略，name 仅用于展示。
  list: (): Promise<{ id: string; name: string }[]> =>
    api.get<{ id: string; name: string }[]>('/strategy/list').then((r) => r.data),
  backtest: (params: {
    market: 'A' | 'HK';
    code: string;
    startDate: string;
    endDate: string;
    period: KlinePeriod;
    strategy: string; // 策略 id
  }): Promise<BacktestResult> =>
    api
      .get<BacktestResult>('/strategy/backtest', { params })
      .then((r) => r.data),
};
