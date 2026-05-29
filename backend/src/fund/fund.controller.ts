import { Controller, Get, Param, Query } from '@nestjs/common';
import { FundService } from './fund.service';

@Controller('fund')
export class FundController {
  constructor(private readonly fundService: FundService) {}

  @Get('search')
  searchFunds(@Query('q') q: string) {
    return this.fundService.searchFunds(q ?? '');
  }

  @Get(':code')
  getFundInfo(@Param('code') code: string) {
    return this.fundService.getFundInfo(code);
  }

  @Get(':code/nav')
  getFundNav(@Param('code') code: string, @Query('limit') limit?: string) {
    const n = Math.min(parseInt(limit ?? '120', 10) || 120, 1000);
    return this.fundService.getFundNav(code, n);
  }
}
