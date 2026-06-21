import type { Strategy } from './strategy.interface';
import { Trend2Strategy } from './trend2.strategy';
import { Trend5Strategy } from './trend5.strategy';
import { Trend8Strategy } from './trend8.strategy';

// 注册所有可用策略：新增策略实现 Strategy 接口后加入此数组即可。
const STRATEGIES: Strategy[] = [new Trend2Strategy(), new Trend5Strategy(), new Trend8Strategy()];

const registry = new Map<string, Strategy>(STRATEGIES.map((s) => [s.id, s]));

/** 按 id 获取策略，未注册返回 undefined。 */
export function getStrategy(id: string): Strategy | undefined {
  return registry.get(id);
}

/** 所有已注册策略 id。 */
export function strategyIds(): string[] {
  return [...registry.keys()];
}

/** 供前端选择的策略清单：稳定 id + 展示名称。 */
export function listStrategies(): { id: string; name: string }[] {
  return STRATEGIES.map((s) => ({ id: s.id, name: s.name }));
}

export * from './strategy.interface';
