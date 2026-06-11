interface Entry<T> {
  data: T;
  expiresAt: number;
}

export class MemCache<T> {
  private store = new Map<string, Entry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }
}

/** UTC+8 工作日分钟数 */
function hkt8Mins(now = Date.now()): { day: number; mins: number } {
  const hkt = new Date(now + 8 * 3600 * 1000);
  return {
    day: hkt.getUTCDay(),
    mins: hkt.getUTCHours() * 60 + hkt.getUTCMinutes(),
  };
}

/**
 * 判断指定市场当前是否在交易时段（UTC+8 工作日）
 * A股：09:30–11:30、13:00–15:00
 * HK ：09:30–12:00、13:00–16:00
 */
export function isTradingMarket(market: 'A' | 'HK', now = Date.now()): boolean {
  const { day, mins } = hkt8Mins(now);
  if (day === 0 || day === 6) return false;
  if (market === 'A') {
    return (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) || (mins >= 13 * 60 && mins < 15 * 60);
  }
  return (mins >= 9 * 60 + 30 && mins < 12 * 60) || (mins >= 13 * 60 && mins < 16 * 60);
}

/** 任意市场在交易时段内即返回 true（用于缓存 TTL 和轮询外层守卫）*/
export function isTrading(now = Date.now()): boolean {
  const { day, mins } = hkt8Mins(now);
  if (day === 0 || day === 6) return false;
  return (mins >= 9 * 60 + 30 && mins < 12 * 60) || (mins >= 13 * 60 && mins < 16 * 60);
}

/** 交易时段用 tradingMs，盘外用 offHoursMs */
export function tradingTtl(tradingMs: number, offHoursMs: number, now = Date.now()): number {
  return isTrading(now) ? tradingMs : offHoursMs;
}
