import { Module } from '@nestjs/common';
import { KlineService } from './kline.service';
import { KlineController } from './kline.controller';
import { StocksModule } from '../stocks/stocks.module';

@Module({
  imports: [StocksModule],
  providers: [KlineService],
  controllers: [KlineController],
  exports: [KlineService],
})
export class KlineModule {}
