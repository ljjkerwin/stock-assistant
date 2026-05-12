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
  ma: {
    ma5: number | null;
    ma10: number | null;
    ma20: number | null;
    ma60: number | null;
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

// ── 监控模块 ──────────────────────────────────────────────────────────────────

export type MonitorType =
  | 'price_above'
  | 'price_below'
  | 'ma_cross_above'
  | 'ma_cross_below';

export type MaPeriod = 'ma5' | 'ma10' | 'ma20';

export interface MonitorRule {
  id: number;
  stockCode: string;
  stockMarket: 'A' | 'HK';
  stockName: string;
  type: MonitorType;
  targetPrice: number | null;
  maPeriod: MaPeriod | null;
  active: boolean;
  lastTriggeredAt: number | null;
  createdAt: number;
}

export interface MonitorMessage {
  id: number;
  ruleId: number;
  stockCode: string;
  stockMarket: 'A' | 'HK';
  stockName: string;
  type: MonitorType;
  currentPrice: number;
  targetValue: number;
  maPeriod: MaPeriod | null;
  triggeredAt: number;
  /** 仅客户端维护，不持久化 */
  read: boolean;
}
