export interface Stock {
  id?: number;
  code: string;
  market: 'A' | 'HK';
  name: string;
  sortOrder?: number;
  pinned?: boolean;
}

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

export interface KlineResponse {
  code: string;
  name: string;
  market: string;
  period: string;
  data: KlineBar[];
}

export type KlinePeriod =
  | 'timeshare'
  | '1min'
  | '5min'
  | '15min'
  | '30min'
  | '60min'
  | 'daily'
  | 'weekly';

export const PERIOD_LABELS: Record<KlinePeriod, string> = {
  timeshare: '分时',
  '1min': '1分',
  '5min': '5分',
  '15min': '15分',
  '30min': '30分',
  '60min': '60分',
  daily: '日线',
  weekly: '周线',
};
