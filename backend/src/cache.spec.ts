import { MemCache, isTradingMarket, isTrading, tradingTtl } from './cache';

describe('cache.ts', () => {
  describe('MemCache', () => {
    let cache: MemCache<string>;

    beforeEach(() => {
      cache = new MemCache<string>();
    });

    it('sets and gets value before expiration', () => {
      cache.set('key', 'value', 1000);
      expect(cache.get('key')).toBe('value');
    });

    it('returns undefined and purges key after expiration', () => {
      cache.set('key', 'value', -10); // Expired immediately
      expect(cache.get('key')).toBeUndefined();
    });

    it('returns undefined for non-existent key', () => {
      expect(cache.get('non_existent')).toBeUndefined();
    });
  });

  describe('isTradingMarket', () => {
    // 2026-06-15 is Monday (Weekday)
    // 2026-06-14 is Sunday (Weekend)

    describe('A-Share Trading Hours (09:30-11:30, 13:00-15:00 Beijing time)', () => {
      it('returns true during morning session', () => {
        const time = Date.UTC(2026, 5, 15, 1, 30); // 09:30 Beijing
        expect(isTradingMarket('A', time)).toBe(true);

        const time2 = Date.UTC(2026, 5, 15, 3, 29); // 11:29 Beijing
        expect(isTradingMarket('A', time2)).toBe(true);
      });

      it('returns false during morning lunch break', () => {
        const time = Date.UTC(2026, 5, 15, 3, 30); // 11:30 Beijing
        expect(isTradingMarket('A', time)).toBe(false);

        const time2 = Date.UTC(2026, 5, 15, 4, 30); // 12:30 Beijing
        expect(isTradingMarket('A', time2)).toBe(false);
      });

      it('returns true during afternoon session', () => {
        const time = Date.UTC(2026, 5, 15, 5, 0); // 13:00 Beijing
        expect(isTradingMarket('A', time)).toBe(true);

        const time2 = Date.UTC(2026, 5, 15, 6, 59); // 14:59 Beijing
        expect(isTradingMarket('A', time2)).toBe(true);
      });

      it('returns false after market close or before open', () => {
        const time = Date.UTC(2026, 5, 15, 7, 0); // 15:00 Beijing
        expect(isTradingMarket('A', time)).toBe(false);

        const time2 = Date.UTC(2026, 5, 15, 1, 29); // 09:29 Beijing
        expect(isTradingMarket('A', time2)).toBe(false);
      });

      it('returns false on weekends', () => {
        const time = Date.UTC(2026, 5, 14, 2, 0); // Sunday 10:00 Beijing
        expect(isTradingMarket('A', time)).toBe(false);
      });
    });

    describe('HK-Share Trading Hours (09:30-12:00, 13:00-16:00 Beijing time)', () => {
      it('returns true during morning session', () => {
        const time = Date.UTC(2026, 5, 15, 1, 30); // 09:30 Beijing
        expect(isTradingMarket('HK', time)).toBe(true);

        const time2 = Date.UTC(2026, 5, 15, 3, 59); // 11:59 Beijing
        expect(isTradingMarket('HK', time2)).toBe(true);
      });

      it('returns false during morning lunch break', () => {
        const time = Date.UTC(2026, 5, 15, 4, 0); // 12:00 Beijing
        expect(isTradingMarket('HK', time)).toBe(false);

        const time2 = Date.UTC(2026, 5, 15, 4, 30); // 12:30 Beijing
        expect(isTradingMarket('HK', time2)).toBe(false);
      });

      it('returns true during afternoon session', () => {
        const time = Date.UTC(2026, 5, 15, 5, 0); // 13:00 Beijing
        expect(isTradingMarket('HK', time)).toBe(true);

        const time2 = Date.UTC(2026, 5, 15, 7, 59); // 15:59 Beijing
        expect(isTradingMarket('HK', time2)).toBe(true);
      });

      it('returns false after market close or before open', () => {
        const time = Date.UTC(2026, 5, 15, 8, 0); // 16:00 Beijing
        expect(isTradingMarket('HK', time)).toBe(false);

        const time2 = Date.UTC(2026, 5, 15, 1, 29); // 09:29 Beijing
        expect(isTradingMarket('HK', time2)).toBe(false);
      });

      it('returns false on weekends', () => {
        const time = Date.UTC(2026, 5, 14, 5, 0); // Sunday 13:00 Beijing
        expect(isTradingMarket('HK', time)).toBe(false);
      });
    });
  });

  describe('isTrading', () => {
    it('returns true if any market is open', () => {
      const time = Date.UTC(2026, 5, 15, 3, 45); // 11:45 Beijing (A is closed, HK is open)
      expect(isTrading(time)).toBe(true);
    });

    it('returns false if all markets are closed', () => {
      const time = Date.UTC(2026, 5, 15, 8, 30); // 16:30 Beijing (Both closed)
      expect(isTrading(time)).toBe(false);
    });
  });

  describe('tradingTtl', () => {
    it('returns tradingMs when market is open', () => {
      const time = Date.UTC(2026, 5, 15, 1, 30); // 09:30 Beijing
      expect(tradingTtl(10, 100, time)).toBe(10);
    });

    it('returns offHoursMs when market is closed', () => {
      const time = Date.UTC(2026, 5, 15, 8, 30); // 16:30 Beijing
      expect(tradingTtl(10, 100, time)).toBe(100);
    });
  });
});
