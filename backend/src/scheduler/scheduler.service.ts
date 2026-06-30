import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { isTrading } from '../cache';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly tick$ = new Subject<number>();
  private tickCount = 0;

  onModuleInit() {
    this.logger.log('系统中央心跳服务已启动（1分钟/次）');
    // 延迟 10 秒后首次执行
    this.timer = setTimeout(() => void this.loop(), 10000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.tick$.complete();
  }

  private loop() {
    if (isTrading()) {
      this.tickCount++;
      this.logger.debug(`[心跳] 第 ${this.tickCount} 次 Tick 开始`);
      this.tick$.next(this.tickCount);
    }

    if (this.timer !== null) {
      this.timer = setTimeout(() => void this.loop(), 60000);
    }
  }
}
