export interface Stock {
  id?: number;
  code: string;
  market: 'A' | 'HK' | 'FUND';
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
  signal?: 'buy' | 'sell' | null;
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

// ── 基金模块 ──────────────────────────────────────────────────────────────────

export interface FundSearchResult {
  code: string;
  name: string;
  type: string;
}

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

export type FundNavPeriod = '1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL';

export const FUND_PERIOD_LABELS: Record<FundNavPeriod, string> = {
  '1M': '近1月',
  '3M': '近3月',
  '6M': '近6月',
  '1Y': '近1年',
  '3Y': '近3年',
  ALL: '全部',
};

export const FUND_PERIOD_LIMITS: Record<FundNavPeriod, number> = {
  '1M': 25,
  '3M': 70,
  '6M': 135,
  '1Y': 255,
  '3Y': 760,
  ALL: 1000,
};

// ── 监控模块 ──────────────────────────────────────────────────────────────────

export type MonitorType =
  | 'price_above'
  | 'price_below'
  | 'ma_cross_above'
  | 'ma_cross_below';

export type MaPeriod = 'ma5' | 'ma10' | 'ma20' | 'ma60';

export interface MonitorRule {
  id: number;
  stockCode: string;
  stockMarket: 'A' | 'HK';
  stockName: string;
  type: MonitorType;
  targetPrice: number | null;
  maPeriod: MaPeriod | null;
  /** MA 穿越规则的 K 线周期，null 表示日线 */
  klinePeriod: string | null;
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
  klinePeriod: string | null;
  triggeredAt: number;
  read: boolean;
}
