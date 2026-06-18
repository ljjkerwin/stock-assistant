import { Controller, Get, Query } from '@nestjs/common';
import { StrategyService, BacktestResult } from './strategy.service';

@Controller('api/strategy')
export class StrategyController {
  constructor(private strategyService: StrategyService) {}

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
