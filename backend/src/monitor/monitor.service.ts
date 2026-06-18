import { Injectable, Logger, MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import { MonitorRule } from './monitor-rule.entity';
import { MonitorMessage } from './monitor-message.entity';
import { StocksService } from '../stocks/stocks.service';
import { KlineService } from '../kline/kline.service';
import { EmailService } from './email.service';
import { isTrading, isTradingMarket } from '../cache';
import { CreateRuleDto } from './dto/create-rule.dto';
import { evaluateRule, MaValues } from './rule-evaluator';

const POLL_INTERVAL_MS = 30_000;

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
    private readonly emailService: EmailService,
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

    this.logger.debug(`[轮询] 开始检查，共 ${rules.length} 条活跃规则`);

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

      if (!isTradingMarket(market)) continue;

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

      // 按 K 线周期分组收集 MA 规则所需的数据
      const neededKlinePeriods = new Set<string>();
      for (const rule of stockRules) {
        if (rule.type === 'ma_cross_above' || rule.type === 'ma_cross_below') {
          neededKlinePeriods.add(rule.klinePeriod ?? 'daily');
        }
      }

      const maValuesMap = new Map<string, MaValues | null>();
      for (const kp of neededKlinePeriods) {
        try {
          const kline = await this.klineService.getKline(market, code, kp);
          if (kline.data.length > 0) {
            const last = kline.data[kline.data.length - 1];
            maValuesMap.set(kp, last.ma);
            this.logger.debug(
              `[轮询] ${market}:${code} [${kp}] MA5=${last.ma.ma5} MA10=${last.ma.ma10} MA20=${last.ma.ma20} MA60=${last.ma.ma60}`,
            );
          } else {
            maValuesMap.set(kp, null);
          }
        } catch (err) {
          this.logger.warn(
            `[轮询] 获取 ${market}:${code} ${kp} K线失败: ${(err as Error).message}`,
          );
          maValuesMap.set(kp, null);
        }
      }

      for (const rule of stockRules) {
        const kp = rule.klinePeriod ?? 'daily';
        const maValues =
          rule.type === 'ma_cross_above' || rule.type === 'ma_cross_below'
            ? (maValuesMap.get(kp) ?? null)
            : null;
        const fired = await this.checkRule(rule, currentPrice, maValues);
        if (fired) triggered++;
      }
    }

    if (triggered > 0) {
      this.logger.log(`[轮询] 完成，触发 ${triggered} 条规则`);
    } else {
      this.logger.debug('[轮询] 完成，无规则触发');
    }
  }

  private async checkRule(
    rule: MonitorRule,
    currentPrice: number,
    maValues: MaValues | null,
  ): Promise<boolean> {
    const res = evaluateRule(rule, currentPrice, maValues);

    if (res.nextPrevAboveMA !== rule.prevAboveMA) {
      await this.ruleRepo.update(rule.id, { prevAboveMA: res.nextPrevAboveMA });
      if (rule.prevAboveMA === null && res.nextPrevAboveMA !== null) {
        this.logger.debug(
          `[轮询] 规则 #${rule.id} 初始化均线状态：价格${res.nextPrevAboveMA ? '在' : '在'}${rule.maPeriod?.toUpperCase()}${res.nextPrevAboveMA ? '上方' : '下方'}`,
        );
      }
    }

    if (res.shouldFire && res.targetValue !== null) {
      await this.fire(rule, currentPrice, res.targetValue);
      return true;
    }

    if (res.reason === 'cooldown') {
      if (rule.type === 'price_above' || rule.type === 'price_below') {
        this.logger.debug(`[轮询] 规则 #${rule.id} 冷却中 (${rule.type})，跳过`);
      } else {
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
      klinePeriod: rule.klinePeriod ?? null,
      triggeredAt: now,
    });
    await this.messageRepo.save(message);
    await this.ruleRepo.update(rule.id, { lastTriggeredAt: now });

    void this.emailService.sendMonitorAlert({
      stockName: rule.stockName,
      stockCode: rule.stockCode,
      stockMarket: rule.stockMarket,
      type: rule.type,
      currentPrice,
      targetValue,
      maPeriod: rule.maPeriod,
      triggeredAt: now,
    });

    const kpLabel = rule.klinePeriod ? `[${rule.klinePeriod}]` : '';
    this.logger.log(
      `[轮询] 规则 #${rule.id} 触发 ` +
        `${rule.stockName}(${rule.stockCode}·${rule.stockMarket}) ` +
        `${rule.type}` +
        (rule.maPeriod ? ` ${rule.maPeriod.toUpperCase()}${kpLabel}` : '') +
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
        klinePeriod: rule.klinePeriod ?? null,
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
      klinePeriod: dto.klinePeriod ?? null,
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
    return { items, total };
  }

  async markMessagesRead(ids: number[]): Promise<void> {
    await this.messageRepo.update(ids, { read: true });
  }

  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.messageRepo.count({ where: { read: false } });
    return { count };
  }

  async clearMessages(): Promise<void> {
    await this.messageRepo.clear();
  }
}
