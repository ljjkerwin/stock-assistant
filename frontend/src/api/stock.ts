import axios from 'axios';
import type {
  Stock,
  StockInfo,
  KlineResponse,
  KlinePeriod,
  MonitorRule,
  MonitorMessage,
  FundInfo,
  FundNavResponse,
  FundSearchResult,
  FundHoldingPeriod,
} from '../types';

const api = axios.create({ baseURL: '/api' });

export const favoritesApi = {
  list: () => api.get<Stock[]>('/favorites').then((r) => r.data),
  add: (stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string }) =>
    api.post<Stock>('/favorites', stock).then((r) => r.data),
  remove: (id: number) => api.delete(`/favorites/${id}`),
  update: (id: number, data: { sortOrder?: number; pinned?: boolean }) =>
    api.patch<Stock>(`/favorites/${id}`, data).then((r) => r.data),
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
