import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { DarkTradeService } from './darktrade.service';

interface RefreshIndexBody {
  date?: string;
  sortFlag?: number;
  desc?: number;
}

@Controller('api/darktrade')
export class DarkTradeController {
  constructor(private readonly darkTradeService: DarkTradeService) {}

  @Get('index-status')
  getIndexStatus() {
    return this.darkTradeService.getIndexStatus();
  }

  @Post('refresh-index')
  refreshIndex(@Body() body: RefreshIndexBody = {}) {
    const { date, sortFlag, desc } = body;
    return this.darkTradeService.refreshIndex(date, sortFlag, desc);
  }

  @Get('batch')
  getBatchDarkTrade(@Query('codes') codes: string, @Query('date') date?: string) {
    const codeList = codes ? codes.split(',').filter(Boolean) : [];
    return this.darkTradeService.getBatchDarkTrade(codeList, date);
  }

  @Get('snapshots-batch')
  getSnapshotsBatch(
    @Query('codes') codes: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    const codeList = codes ? codes.split(',').filter(Boolean) : [];
    return this.darkTradeService.getSnapshotsBatch(codeList, days);
  }

  @Get('snapshots/:code')
  getSnapshots(
    @Param('code') code: string,
    @Query('days', new DefaultValuePipe(60), ParseIntPipe) days: number,
  ) {
    return this.darkTradeService.getSnapshots(code, days);
  }

  @Get(':code')
  getDarkTrade(@Param('code') code: string) {
    return this.darkTradeService.getDarkTrade(code);
  }
}
