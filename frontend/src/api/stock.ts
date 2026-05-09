import axios from 'axios';
import type { Stock, StockInfo, KlineResponse, KlinePeriod } from '../types';

const api = axios.create({ baseURL: '/api' });

export const favoritesApi = {
  list: () => api.get<Stock[]>('/favorites').then((r) => r.data),
  add: (stock: { code: string; market: 'A' | 'HK'; name: string }) =>
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
