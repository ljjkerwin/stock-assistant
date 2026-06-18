import type { Strategy } from './strategy.interface';
import { TrendStrategy } from './trend.strategy';

// 注册所有可用策略：新增策略实现 Strategy 接口后加入此数组即可。
const STRATEGIES: Strategy[] = [new TrendStrategy()];

const registry = new Map<string, Strategy>(STRATEGIES.map((s) => [s.name, s]));

/** 按名称获取策略，未注册返回 undefined。 */
export function getStrategy(name: string): Strategy | undefined {
  return registry.get(name);
}

/** 所有已注册策略名称。 */
export function strategyNames(): string[] {
  return [...registry.keys()];
}

export * from './strategy.interface';
