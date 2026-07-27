export type MaPeriod = 'ma5' | 'ma10' | 'ma20' | 'ma60';

export interface MaValues {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
}

export const COOLDOWN_MS = 30 * 60_000;

export interface RuleEvalResult {
  shouldFire: boolean;
  nextPrevAboveMA: boolean | null;
  targetValue: number | null;
  reason?: 'cooldown' | 'no_cross' | 'initialize' | 'ma_null' | 'no_match';
}

function isMaPeriod(v: string | null): v is MaPeriod {
  return v === 'ma5' || v === 'ma10' || v === 'ma20' || v === 'ma60';
}

export function evaluateRule(
  rule: {
    id: number;
    type: string;
    targetPrice: number | null;
    maPeriod: string | null;
    prevAboveMA: boolean | null;
    lastTriggeredAt: number | null;
  },
  currentPrice: number,
  maValues: MaValues | null,
  now = Date.now(),
): RuleEvalResult {
  const cooledDown = rule.lastTriggeredAt == null || now - rule.lastTriggeredAt >= COOLDOWN_MS;

  if ((rule.type === 'price_above' || rule.type === 'price_below') && rule.targetPrice != null) {
    const isAboveNow = currentPrice > rule.targetPrice;
    const conditionMet = rule.type === 'price_above' ? isAboveNow : !isAboveNow;

    // 固定价格规则也按边沿触发：同一侧持续停留时不重复通知；价格回到另一侧后重新布防。
    // 首次检查若已满足条件仍通知一次，保持新建规则的即时生效体验。
    if (rule.prevAboveMA == null) {
      return {
        shouldFire: conditionMet,
        nextPrevAboveMA: isAboveNow,
        targetValue: conditionMet ? rule.targetPrice : null,
        reason: conditionMet ? undefined : 'initialize',
      };
    }

    const crossed =
      rule.type === 'price_above'
        ? !rule.prevAboveMA && isAboveNow
        : rule.prevAboveMA && !isAboveNow;

    if (!crossed) {
      return {
        shouldFire: false,
        nextPrevAboveMA: isAboveNow,
        targetValue: null,
        reason: 'no_match',
      };
    }

    if (cooledDown) {
      return { shouldFire: true, nextPrevAboveMA: isAboveNow, targetValue: rule.targetPrice };
    }
    return {
      shouldFire: false,
      nextPrevAboveMA: isAboveNow,
      targetValue: null,
      reason: 'cooldown',
    };
  }

  if (
    (rule.type === 'ma_cross_above' || rule.type === 'ma_cross_below') &&
    isMaPeriod(rule.maPeriod)
  ) {
    if (maValues == null) {
      return {
        shouldFire: false,
        nextPrevAboveMA: rule.prevAboveMA,
        targetValue: null,
        reason: 'ma_null',
      };
    }
    const maValue = maValues[rule.maPeriod];
    if (maValue == null) {
      return {
        shouldFire: false,
        nextPrevAboveMA: rule.prevAboveMA,
        targetValue: null,
        reason: 'ma_null',
      };
    }

    const isAboveNow = currentPrice > maValue;

    if (rule.prevAboveMA == null) {
      // 首次检查：记录初始状态，不触发
      return {
        shouldFire: false,
        nextPrevAboveMA: isAboveNow,
        targetValue: null,
        reason: 'initialize',
      };
    }

    const wasAbove = rule.prevAboveMA;
    const crossed =
      rule.type === 'ma_cross_above' ? !wasAbove && isAboveNow : wasAbove && !isAboveNow;

    if (crossed) {
      if (cooledDown) {
        return { shouldFire: true, nextPrevAboveMA: isAboveNow, targetValue: maValue };
      }
      return {
        shouldFire: false,
        nextPrevAboveMA: isAboveNow,
        targetValue: null,
        reason: 'cooldown',
      };
    }

    return {
      shouldFire: false,
      nextPrevAboveMA: isAboveNow,
      targetValue: null,
      reason: 'no_cross',
    };
  }

  return { shouldFire: false, nextPrevAboveMA: null, targetValue: null, reason: 'no_match' };
}
