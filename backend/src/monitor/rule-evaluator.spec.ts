import { evaluateRule, COOLDOWN_MS } from './rule-evaluator';

describe('rule-evaluator.ts', () => {
  const baseRule = {
    id: 1,
    type: 'price_above',
    targetPrice: 100,
    maPeriod: null,
    prevAboveMA: null,
    lastTriggeredAt: null,
  };

  describe('price_above', () => {
    it('fires when price exceeds targetPrice', () => {
      const result = evaluateRule(baseRule, 101, null);
      expect(result.shouldFire).toBe(true);
      expect(result.targetValue).toBe(100);
    });

    it('does not fire when price is below targetPrice', () => {
      const result = evaluateRule(baseRule, 99, null);
      expect(result.shouldFire).toBe(false);
      expect(result.reason).toBe('no_match');
    });

    it('respects cooldown time', () => {
      const now = Date.now();
      const rule = { ...baseRule, lastTriggeredAt: now - 1000 }; // Triggered 1s ago

      const result = evaluateRule(rule, 101, null, now);
      expect(result.shouldFire).toBe(false);
      expect(result.reason).toBe('cooldown');

      // After cooldown passes
      const result2 = evaluateRule(rule, 101, null, now + COOLDOWN_MS);
      expect(result2.shouldFire).toBe(true);
    });
  });

  describe('price_below', () => {
    const rule = { ...baseRule, type: 'price_below', targetPrice: 50 };

    it('fires when price is below targetPrice', () => {
      const result = evaluateRule(rule, 49, null);
      expect(result.shouldFire).toBe(true);
      expect(result.targetValue).toBe(50);
    });

    it('does not fire when price exceeds targetPrice', () => {
      const result = evaluateRule(rule, 51, null);
      expect(result.shouldFire).toBe(false);
      expect(result.reason).toBe('no_match');
    });
  });

  describe('ma_cross_above', () => {
    const maRule = {
      id: 2,
      type: 'ma_cross_above',
      targetPrice: null,
      maPeriod: 'ma20',
      prevAboveMA: null,
      lastTriggeredAt: null,
    };
    const maValues = { ma5: null, ma10: null, ma20: 100, ma60: null };

    it('initializes and does not fire on first check', () => {
      // Price is above MA
      const result = evaluateRule(maRule, 105, maValues);
      expect(result.shouldFire).toBe(false);
      expect(result.nextPrevAboveMA).toBe(true);
      expect(result.reason).toBe('initialize');

      // Price is below MA
      const result2 = evaluateRule(maRule, 95, maValues);
      expect(result2.shouldFire).toBe(false);
      expect(result2.nextPrevAboveMA).toBe(false);
      expect(result2.reason).toBe('initialize');
    });

    it('fires when price crosses above MA', () => {
      const rule = { ...maRule, prevAboveMA: false };
      const result = evaluateRule(rule, 105, maValues);
      expect(result.shouldFire).toBe(true);
      expect(result.nextPrevAboveMA).toBe(true);
      expect(result.targetValue).toBe(100);
    });

    it('does not fire when price remains below or above MA without crossing', () => {
      // Remains below
      const rule1 = { ...maRule, prevAboveMA: false };
      const result1 = evaluateRule(rule1, 95, maValues);
      expect(result1.shouldFire).toBe(false);
      expect(result1.nextPrevAboveMA).toBe(false);
      expect(result1.reason).toBe('no_cross');

      // Remains above
      const rule2 = { ...maRule, prevAboveMA: true };
      const result2 = evaluateRule(rule2, 105, maValues);
      expect(result2.shouldFire).toBe(false);
      expect(result2.nextPrevAboveMA).toBe(true);
      expect(result2.reason).toBe('no_cross');
    });

    it('respects cooldown when crossing above MA', () => {
      const now = Date.now();
      const rule = { ...maRule, prevAboveMA: false, lastTriggeredAt: now - 1000 };
      const result = evaluateRule(rule, 105, maValues, now);
      expect(result.shouldFire).toBe(false);
      expect(result.nextPrevAboveMA).toBe(true);
      expect(result.reason).toBe('cooldown');
    });
  });

  describe('ma_cross_below', () => {
    const maRule = {
      id: 3,
      type: 'ma_cross_below',
      targetPrice: null,
      maPeriod: 'ma5',
      prevAboveMA: null,
      lastTriggeredAt: null,
    };
    const maValues = { ma5: 10, ma10: null, ma20: null, ma60: null };

    it('fires when price crosses below MA', () => {
      const rule = { ...maRule, prevAboveMA: true };
      const result = evaluateRule(rule, 9.5, maValues);
      expect(result.shouldFire).toBe(true);
      expect(result.nextPrevAboveMA).toBe(false);
      expect(result.targetValue).toBe(10);
    });

    it('does not fire when price remains above or below without crossing', () => {
      const rule1 = { ...maRule, prevAboveMA: true };
      const result1 = evaluateRule(rule1, 10.5, maValues);
      expect(result1.shouldFire).toBe(false);
      expect(result1.nextPrevAboveMA).toBe(true);

      const rule2 = { ...maRule, prevAboveMA: false };
      const result2 = evaluateRule(rule2, 9.5, maValues);
      expect(result2.shouldFire).toBe(false);
      expect(result2.nextPrevAboveMA).toBe(false);
    });
  });
});
