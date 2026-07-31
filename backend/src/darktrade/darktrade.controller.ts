import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { DarkTradeService } from './darktrade.service';
import { DarkTradeTextQueryService } from './darktrade-text-query.service';
import type { FetchAllDailySnapshotResult } from './darktrade.service';
import { getRandomCapitalSummarySuffix } from './capital-summary-suffixes';
import { formatCapitalSummaries } from './capital-summary';

interface RefreshIndexBody {
  date?: string;
  sortFlag?: number;
  desc?: number;
}

@Controller('api/darktrade')
export class DarkTradeController {
  constructor(
    private readonly darkTradeService: DarkTradeService,
    private readonly darkTradeTextQueryService: DarkTradeTextQueryService,
  ) {}

  @Get('index-status')
  getIndexStatus() {
    return this.darkTradeService.getIndexStatus();
  }

  @Post('refresh-index')
  refreshIndex(@Body() body: RefreshIndexBody = {}) {
    const { date, sortFlag, desc } = body;
    return this.darkTradeService.refreshIndex(date, sortFlag, desc);
  }

  @Post('fetch-all-daily-snapshot')
  fetchAllDailySnapshot(@Body() body: { date: string }): Promise<FetchAllDailySnapshotResult> {
    return this.darkTradeService.fetchAllDailySnapshot(body.date);
  }

  @Get('batch')
  getBatchDarkTrade(@Query('codes') codes: string, @Query('date') date?: string) {
    const codeList = codes ? codes.split(',').filter(Boolean) : [];
    return this.darkTradeService.getBatchDarkTrade(codeList, date);
  }

  @Get('discovery')
  getDiscoveryStocks(
    @Query('minDarkCapital') minDarkCapital?: string,
    @Query('minMultiple') minMultiple?: string,
    @Query('date') date?: string,
    @Query('capitalDirection') capitalDirection?: string,
  ) {
    return this.darkTradeService.getDiscoveryStocks(
      this.parseNonNegativeNumber(minDarkCapital, 'minDarkCapital'),
      this.parseNonNegativeNumber(minMultiple, 'minMultiple'),
      this.parseDate(date),
      this.parseCapitalDirection(capitalDirection),
    );
  }

  @Get('daily-result')
  async getDailyResultByName(
    @Query('name') name: string | undefined,
    @Query('date') date?: string,
  ) {
    const normalizedName = name?.trim();
    if (!normalizedName) {
      throw new BadRequestException('name 不能为空');
    }
    const result = await this.darkTradeService.getDailyResultByName(
      normalizedName,
      this.parseDate(date),
    );
    if (!result) return null;
    const summarySuffix = getRandomCapitalSummarySuffix();
    return { ...result, summarySuffix, summary: formatCapitalSummaries([result], summarySuffix) };
  }

  @Post('daily-result-from-text')
  getDailyResultsFromText(@Body() body: { text?: string; date?: string }) {
    return this.darkTradeTextQueryService.query(body.text ?? '', this.parseDate(body.date));
  }

  private parseNonNegativeNumber(value: string | undefined, name: string): number | undefined {
    if (value == null) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(`${name} 必须是大于或等于 0 的数字`);
    }
    return parsed;
  }

  private parseDate(value: string | undefined): string | undefined {
    if (value == null) return undefined;
    if (!/^\d{8}$/.test(value)) {
      throw new BadRequestException('date 必须是 YYYYMMDD 格式');
    }
    return value;
  }

  private parseCapitalDirection(value: string | undefined): 'inflow' | 'outflow' | undefined {
    if (value == null) return undefined;
    if (value !== 'inflow' && value !== 'outflow') {
      throw new BadRequestException('capitalDirection 必须是 inflow 或 outflow');
    }
    return value;
  }

  @Get('snapshots-batch')
  getSnapshotsBatch(@Query('codes') codes: string, @Query('date') date?: string) {
    const codeList = codes ? codes.split(',').filter(Boolean) : [];
    return this.darkTradeService.getSnapshotsBatch(codeList, date);
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
