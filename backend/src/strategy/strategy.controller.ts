import { Controller, Get, Query } from '@nestjs/common';
import { StrategyService, BacktestResult } from './strategy.service';
import { listStrategies } from './strategies';

@Controller('api/strategy')
export class StrategyController {
  constructor(private strategyService: StrategyService) {}

  /** 策略清单：稳定 id + 展示名称，供前端下拉选择（改名只需改后端 name）。 */
  @Get('list')
  list(): { id: string; name: string }[] {
    return listStrategies();
  }

  @Get('backtest')
  async backtest(
    @Query('market') market: string,
    @Query('code') code: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('period') period: string,
    @Query('strategy') strategy: string,
  ): Promise<BacktestResult> {
    return this.strategyService.backtest({
      market: market as 'A' | 'HK',
      code,
      startDate,
      endDate,
      period: period as 'daily' | '5min' | '15min' | '30min' | '60min',
      strategy,
    });
  }
}
