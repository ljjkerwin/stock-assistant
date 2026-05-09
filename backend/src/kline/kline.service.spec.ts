import { KlineService } from './kline.service';

describe('KlineService', () => {
  let service: KlineService;

  beforeEach(() => {
    service = new KlineService();
  });

  describe('calcMACD', () => {
    it('returns same number of bars', () => {
      const bars = Array.from({ length: 50 }, (_, i) => ({
        time: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100 + i,
        high: 105 + i,
        low: 95 + i,
        close: 100 + i,
        volume: 1000,
      }));
      const result = service.calcMACD(bars);
      expect(result).toHaveLength(50);
    });

    it('includes macd fields on each bar', () => {
      const bars = Array.from({ length: 40 }, (_, i) => ({
        time: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100,
        high: 105,
        low: 95,
        close: 100 + Math.sin(i) * 5,
        volume: 1000,
      }));
      const result = service.calcMACD(bars);
      for (const bar of result) {
        expect(bar.macd).toBeDefined();
        expect(typeof bar.macd.dif).toBe('number');
        expect(typeof bar.macd.dea).toBe('number');
        expect(typeof bar.macd.bar).toBe('number');
      }
    });

    it('bar equals (dif - dea) * 2', () => {
      const bars = Array.from({ length: 40 }, (_, i) => ({
        time: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100,
        high: 110,
        low: 90,
        close: 100 + i * 0.5,
        volume: 1000,
      }));
      const result = service.calcMACD(bars);
      for (const bar of result) {
        expect(bar.macd.bar).toBeCloseTo((bar.macd.dif - bar.macd.dea) * 2, 3);
      }
    });
  });
});
