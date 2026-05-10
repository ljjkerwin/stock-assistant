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

/** UTC+8 交易时段：工作日 09:30–12:00、13:00–16:00（覆盖 A 股 + 港股）*/
export function isTrading(): boolean {
  const hkt = new Date(Date.now() + 8 * 3600 * 1000);
  const day = hkt.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = hkt.getUTCHours() * 60 + hkt.getUTCMinutes();
  return (mins >= 9 * 60 + 30 && mins < 12 * 60) || (mins >= 13 * 60 && mins < 16 * 60);
}

/** 交易时段用 tradingMs，盘外用 offHoursMs */
export function tradingTtl(tradingMs: number, offHoursMs: number): number {
  return isTrading() ? tradingMs : offHoursMs;
}
