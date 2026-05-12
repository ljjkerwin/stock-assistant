import { Injectable, Logger, MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import { MonitorRule } from './monitor-rule.entity';
import { MonitorMessage } from './monitor-message.entity';
import { StocksService } from '../stocks/stocks.service';
import { KlineService } from '../kline/kline.service';
import { isTrading } from '../cache';
import { CreateRuleDto } from './dto/create-rule.dto';

const POLL_INTERVAL_MS = 30_000;
const COOLDOWN_MS = 30 * 60_000;

type MaPeriod = 'ma5' | 'ma10' | 'ma20';
type MaValues = { ma5: number | null; ma10: number | null; ma20: number | null };

function isMaPeriod(v: string | null): v is MaPeriod {
  return v === 'ma5' || v === 'ma10' || v === 'ma20';
}

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name);
  private readonly events$ = new Subject<MessageEvent>();
  private pollTimer: ReturnType<typeof setInterval>;
  private isPolling = false;

  constructor(
    @InjectRepository(MonitorRule)
    private readonly ruleRepo: Repository<MonitorRule>,
    @InjectRepository(MonitorMessage)
    private readonly messageRepo: Repository<MonitorMessage>,
    private readonly stocksService: StocksService,
    private readonly klineService: KlineService,
  ) {}

  onModuleInit() {
    this.pollTimer = setInterval(() => void this.pollRules(), POLL_INTERVAL_MS);
    this.logger.log('监控轮询服务已启动（间隔 30s）');
  }

  onModuleDestroy() {
    clearInterval(this.pollTimer);
  }

  getEventsStream(): Observable<MessageEvent> {
    return this.events$.asObservable();
  }

  async pollRules(): Promise<void> {
    if (this.isPolling) {
      this.logger.debug('[轮询] 上次轮询未完成，跳过');
      return;
    }
    if (!isTrading()) return;

    this.isPolling = true;
    try {
      await this.doPoll();
    } finally {
      this.isPolling = false;
    }
  }

  private async doPoll(): Promise<void> {
    const rules = await this.ruleRepo.find({ where: { active: true } });
    if (rules.length === 0) return;

    this.logger.log(`[轮询] 开始检查，共 ${rules.length} 条活跃规则`);

    // 按股票分组，减少重复请求
    const stockMap = new Map<string, MonitorRule[]>();
    for (const rule of rules) {
      const key = `${rule.stockMarket}:${rule.stockCode}`;
      const list = stockMap.get(key) ?? [];
      list.push(rule);
      stockMap.set(key, list);
    }

    let triggered = 0;

    for (const [key, stockRules] of stockMap) {
      const colonIdx = key.indexOf(':');
      const market = key.slice(0, colonIdx) as 'A' | 'HK';
      const code = key.slice(colonIdx + 1);

      let currentPrice: number | null = null;
      try {
        const info = await this.stocksService.getInfo(market, code);
        currentPrice = info.price;
        this.logger.debug(`[轮询] ${market}:${code} 当前价 ${currentPrice ?? 'N/A'}`);
      } catch (err) {
        this.logger.warn(`[轮询] 获取 ${market}:${code} 行情失败: ${(err as Error).message}`);
        continue;
      }
      if (currentPrice == null) continue;

      // 仅存在 MA 规则时才请求 K 线
      const needsMA = stockRules.some(
        (r) => r.type === 'ma_cross_above' || r.type === 'ma_cross_below',
      );
      let maValues: MaValues | null = null;
      if (needsMA) {
        const kline = await this.klineService.getKline(market, code, 'daily');
        if (kline.data.length > 0) {
          const last = kline.data[kline.data.length - 1];
          maValues = last.ma;
          this.logger.debug(
            `[轮询] ${market}:${code} MA5=${maValues.ma5} MA10=${maValues.ma10} MA20=${maValues.ma20}`,
          );
        }
      }

      for (const rule of stockRules) {
        const fired = await this.checkRule(rule, currentPrice, maValues);
        if (fired) triggered++;
      }
    }

    this.logger.log(`[轮询] 完成，触发 ${triggered} 条规则`);
  }

  private async checkRule(
    rule: MonitorRule,
    currentPrice: number,
    maValues: MaValues | null,
  ): Promise<boolean> {
    const now = Date.now();
    const cooledDown = rule.lastTriggeredAt == null || now - rule.lastTriggeredAt >= COOLDOWN_MS;

    if (rule.type === 'price_above' && rule.targetPrice != null) {
      if (currentPrice >= rule.targetPrice) {
        if (cooledDown) {
          await this.fire(rule, currentPrice, rule.targetPrice);
          return true;
        }
        this.logger.debug(`[轮询] 规则 #${rule.id} 冷却中 (price_above)，跳过`);
      }
      return false;
    }

    if (rule.type === 'price_below' && rule.targetPrice != null) {
      if (currentPrice <= rule.targetPrice) {
        if (cooledDown) {
          await this.fire(rule, currentPrice, rule.targetPrice);
          return true;
        }
        this.logger.debug(`[轮询] 规则 #${rule.id} 冷却中 (price_below)，跳过`);
      }
      return false;
    }

    if (
      (rule.type === 'ma_cross_above' || rule.type === 'ma_cross_below') &&
      maValues != null &&
      isMaPeriod(rule.maPeriod)
    ) {
      const maValue = maValues[rule.maPeriod];
      if (maValue == null) return false;

      const isAboveNow = currentPrice > maValue;

      if (rule.prevAboveMA == null) {
        // 首次检查：记录初始状态，不触发
        await this.ruleRepo.update(rule.id, { prevAboveMA: isAboveNow });
        this.logger.debug(
          `[轮询] 规则 #${rule.id} 初始化均线状态：价格${isAboveNow ? '在' : '在'}${rule.maPeriod.toUpperCase()}${isAboveNow ? '上方' : '下方'}`,
        );
        return false;
      }

      const wasAbove = rule.prevAboveMA;
      // 无论是否触发，都更新当前状态
      await this.ruleRepo.update(rule.id, { prevAboveMA: isAboveNow });

      const crossed =
        rule.type === 'ma_cross_above' ? !wasAbove && isAboveNow : wasAbove && !isAboveNow;

      if (crossed) {
        if (cooledDown) {
          await this.fire(rule, currentPrice, maValue);
          return true;
        }
        this.logger.debug(`[轮询] 规则 #${rule.id} 检测到均线穿越但冷却中，跳过`);
      }
    }

    return false;
  }

  private async fire(rule: MonitorRule, currentPrice: number, targetValue: number): Promise<void> {
    const now = Date.now();

    const message = this.messageRepo.create({
      ruleId: rule.id,
      stockCode: rule.stockCode,
      stockMarket: rule.stockMarket,
      stockName: rule.stockName,
      type: rule.type,
      currentPrice,
      targetValue,
      maPeriod: rule.maPeriod,
      triggeredAt: now,
    });
    await this.messageRepo.save(message);
    await this.ruleRepo.update(rule.id, { lastTriggeredAt: now });

    this.logger.log(
      `[轮询] 规则 #${rule.id} 触发 ` +
        `${rule.stockName}(${rule.stockCode}·${rule.stockMarket}) ` +
        `${rule.type}` +
        (rule.maPeriod ? ` ${rule.maPeriod.toUpperCase()}` : '') +
        ` | 当前价 ${currentPrice.toFixed(2)}` +
        ` | 目标 ${targetValue.toFixed(2)}`,
    );

    this.events$.next({
      data: {
        id: message.id,
        ruleId: rule.id,
        stockCode: rule.stockCode,
        stockMarket: rule.stockMarket,
        stockName: rule.stockName,
        type: rule.type,
        currentPrice,
        targetValue,
        maPeriod: rule.maPeriod ?? null,
        triggeredAt: now,
      },
    });
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async getRules(): Promise<MonitorRule[]> {
    return this.ruleRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createRule(dto: CreateRuleDto): Promise<MonitorRule> {
    const rule = this.ruleRepo.create({
      stockCode: dto.stockCode,
      stockMarket: dto.stockMarket,
      stockName: dto.stockName,
      type: dto.type,
      targetPrice: dto.targetPrice ?? null,
      maPeriod: dto.maPeriod ?? null,
      active: true,
      createdAt: Date.now(),
    });
    return this.ruleRepo.save(rule);
  }

  async deleteRule(id: number): Promise<void> {
    await this.ruleRepo.delete(id);
  }

  async toggleRule(id: number, active: boolean): Promise<MonitorRule> {
    const update: Partial<MonitorRule> = { active };
    if (active) {
      const rule = await this.ruleRepo.findOneBy({ id });
      if (rule && (rule.type === 'ma_cross_above' || rule.type === 'ma_cross_below')) {
        // 重新激活时重置均线状态，下次轮询重新初始化
        update.prevAboveMA = null;
      }
    }
    await this.ruleRepo.update(id, update);
    return this.ruleRepo.findOneByOrFail({ id });
  }

  async getMessages(page: number): Promise<{ items: MonitorMessage[]; total: number }> {
    const limit = 20;
    const [items, total] = await this.messageRepo.findAndCount({
      order: { triggeredAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });
    const unreadIds = items.filter((m) => !m.read).map((m) => m.id);
    if (unreadIds.length > 0) {
      await this.messageRepo.update(unreadIds, { read: true });
      items.forEach((m) => {
        m.read = true;
      });
    }
    return { items, total };
  }

  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.messageRepo.count({ where: { read: false } });
    return { count };
  }

  async clearMessages(): Promise<void> {
    await this.messageRepo.clear();
  }
}
