import { KlineService, computeKlineAttrs } from './kline.service';

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

    it('computes changePercent relative to previous close; first bar is null', () => {
      const closes = [100, 110, 99];
      const bars = closes.map((c, i) => ({
        time: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: c,
        high: c,
        low: c,
        close: c,
        volume: 1000,
      }));
      const result = service.calcMACD(bars);
      expect(result[0].changePercent).toBeNull();
      expect(result[1].changePercent).toBeCloseTo(10, 2); // (110-100)/100
      expect(result[2].changePercent).toBeCloseTo(-10, 2); // (99-110)/110
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

  describe('RSI6', () => {
    const makeBars = (closes: number[]) =>
      closes.map((close, i) => ({
        time: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
      }));

    it('首根 K 线 rsi6 为 null（无前收）', () => {
      const result = service.calcMACD(makeBars([100, 101, 102, 103, 104, 105, 106]));
      expect(result[0].rsi.rsi6).toBeNull();
    });

    it('单调上涨序列 rsi6 为 100', () => {
      const result = service.calcMACD(makeBars(Array.from({ length: 20 }, (_, i) => 100 + i)));
      expect(result[result.length - 1].rsi.rsi6).toBe(100);
    });

    it('单调下跌序列 rsi6 为 0', () => {
      const result = service.calcMACD(makeBars(Array.from({ length: 20 }, (_, i) => 200 - i)));
      expect(result[result.length - 1].rsi.rsi6).toBe(0);
    });
  });

  describe('综合属性（attrs）', () => {
    const base = {
      macd: { dif: 0, dea: 0, bar: 0 },
      ma: { ma5: null, ma10: null, ma20: null, ma60: null },
      rsi: { rsi6: null },
      close: 100,
    };

    describe('KMACD', () => {
      it('满足：dif>0 且 dif-dea>-0.02 且 dif 上升', () => {
        const bar = { ...base, macd: { dif: 1, dea: 1, bar: 0 } };
        expect(computeKlineAttrs(bar, 0.5).kmacd).toBe(true);
      });

      it('不满足：dif<=0', () => {
        const bar = { ...base, macd: { dif: -0.5, dea: -0.5, bar: 0 } };
        expect(computeKlineAttrs(bar, -1).kmacd).toBe(false);
      });

      it('满足：dif-dea 略高于 -0.02 边界', () => {
        const bar = { ...base, macd: { dif: 0.99, dea: 1, bar: 0 } }; // dif-dea = -0.01
        expect(computeKlineAttrs(bar, 0.5).kmacd).toBe(true);
      });

      it('不满足：dif-dea 恰好等于 -0.02（严格大于）', () => {
        const bar = { ...base, macd: { dif: 0.98, dea: 1, bar: 0 } }; // dif-dea = -0.02
        expect(computeKlineAttrs(bar, 0.5).kmacd).toBe(false);
      });

      it('不满足：dif-dea < -0.02（DIF 距 DEA 太远）', () => {
        const bar = { ...base, macd: { dif: 1, dea: 2, bar: 0 } };
        expect(computeKlineAttrs(bar, 0.5).kmacd).toBe(false);
      });

      it('满足：dif 微跌但在 1% 容差内（dif/prevDif > 0.99）', () => {
        const bar = { ...base, macd: { dif: 0.995, dea: 1, bar: 0 } };
        expect(computeKlineAttrs(bar, 1).kmacd).toBe(true);
      });

      it('不满足：dif 跌幅超过 1% 容差', () => {
        const bar = { ...base, macd: { dif: 1, dea: 1, bar: 0 } };
        expect(computeKlineAttrs(bar, 1.5).kmacd).toBe(false);
      });

      it('不满足：首根 K 线无前值', () => {
        const bar = { ...base, macd: { dif: 1, dea: 1, bar: 0 } };
        expect(computeKlineAttrs(bar, null).kmacd).toBe(false);
      });
    });

    describe('KRSI', () => {
      it('满足：rsi6 >= 50', () => {
        expect(computeKlineAttrs({ ...base, rsi: { rsi6: 50 } }, null).krsi).toBe(true);
      });
      it('不满足：rsi6 < 50', () => {
        expect(computeKlineAttrs({ ...base, rsi: { rsi6: 49.9 } }, null).krsi).toBe(false);
      });
      it('不满足：rsi6 为 null', () => {
        expect(computeKlineAttrs({ ...base, rsi: { rsi6: null } }, null).krsi).toBe(false);
      });
    });

    describe('KMA', () => {
      it('满足：close>ma10 且 ma5>ma10', () => {
        const bar = { ...base, close: 110, ma: { ma5: 105, ma10: 100, ma20: null, ma60: null } };
        expect(computeKlineAttrs(bar, null).kma).toBe(true);
      });
      it('不满足：close<=ma10', () => {
        const bar = { ...base, close: 100, ma: { ma5: 105, ma10: 100, ma20: null, ma60: null } };
        expect(computeKlineAttrs(bar, null).kma).toBe(false);
      });
      it('不满足：ma5<=ma10', () => {
        const bar = { ...base, close: 110, ma: { ma5: 100, ma10: 100, ma20: null, ma60: null } };
        expect(computeKlineAttrs(bar, null).kma).toBe(false);
      });
      it('不满足：ma 为 null', () => {
        const bar = { ...base, close: 110, ma: { ma5: null, ma10: null, ma20: null, ma60: null } };
        expect(computeKlineAttrs(bar, null).kma).toBe(false);
      });
    });

    it('calcMACD 为每根 K 线附带 attrs 布尔字段', () => {
      const bars = Array.from({ length: 20 }, (_, i) => ({
        time: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100 + i,
        high: 105 + i,
        low: 95 + i,
        close: 100 + i,
        volume: 1000,
      }));
      const result = service.calcMACD(bars);
      result.forEach((bar) => {
        expect(typeof bar.attrs.kmacd).toBe('boolean');
        expect(typeof bar.attrs.krsi).toBe('boolean');
        expect(typeof bar.attrs.kma).toBe('boolean');
      });
    });
  });
});
