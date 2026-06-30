import { Controller, Get, Param, Query } from '@nestjs/common';
import { KlineService } from './kline.service';
import { StocksService } from '../stocks/stocks.service';

@Controller('api/kline')
export class KlineController {
  constructor(
    private readonly service: KlineService,
    private readonly stocksService: StocksService,
  ) {}

  @Get(':market/:code')
  async getKline(
    @Param('market') market: 'A' | 'HK',
    @Param('code') code: string,
    @Query('period') period: string = 'timeshare',
  ) {
    const result = await this.service.getKline(market, code, period);

    // 前复权（qfq）数据中，当日发生除权除息时昨日复权价会被调低，
    // 导致 (今收 - 昨复权收) / 昨复权收 算出的涨幅虚高，与交易所官方涨幅不符。
    // 日线周期：用东方财富实时行情（f170）的官方涨跌幅覆盖最后一根 bar 的 changePercent。
    // StocksService.getInfo 内部有 30s 缓存，无额外性能损耗。
    if (period === 'daily' && result.data.length > 0) {
      try {
        const info = await this.stocksService.getInfo(market, code);
        if (info.change_pct != null) {
          // 不直接修改缓存引用，做浅拷贝后覆盖
          const data = [...result.data];
          data[data.length - 1] = {
            ...data[data.length - 1],
            changePercent: info.change_pct,
          };
          return { ...result, data };
        }
      } catch {
        // 实时行情获取失败时降级：返回复权计算的涨幅，不中断 K 线渲染
      }
    }

    return result;
  }
}
