import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DarkTradeIndex } from './dark-trade-index.entity';
import { DarkTradeSnapshot } from './dark-trade-snapshot.entity';
import { DarkTradeDailyResult } from './dark-trade-daily-result.entity';
import { Favorite } from '../favorites/favorite.entity';
import { DarkTradeController } from './darktrade.controller';
import { DarkTradeService } from './darktrade.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DarkTradeIndex, DarkTradeSnapshot, DarkTradeDailyResult, Favorite]),
  ],
  controllers: [DarkTradeController],
  providers: [DarkTradeService],
})
export class DarkTradeModule {}
