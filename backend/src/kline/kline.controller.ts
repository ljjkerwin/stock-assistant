import { Controller, Get, Param, Query } from '@nestjs/common';
import { KlineService } from './kline.service';

@Controller('api/kline')
export class KlineController {
  constructor(private readonly service: KlineService) {}

  @Get(':market/:code')
  getKline(
    @Param('market') market: 'A' | 'HK',
    @Param('code') code: string,
    @Query('period') period: string = 'timeshare',
  ) {
    return this.service.getKline(market, code, period);
  }
}
