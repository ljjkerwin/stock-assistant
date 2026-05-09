import { Controller, Get, Param, Query } from '@nestjs/common';
import { StocksService } from './stocks.service';

@Controller('api/stocks')
export class StocksController {
  constructor(private readonly service: StocksService) {}

  @Get('search')
  search(@Query('q') q: string) {
    return this.service.search(q ?? '');
  }

  @Get(':market/:code')
  getInfo(@Param('market') market: 'A' | 'HK', @Param('code') code: string) {
    return this.service.getInfo(market, code);
  }
}
