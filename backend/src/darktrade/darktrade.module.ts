import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DarkTradeIndex } from './dark-trade-index.entity';
import { DarkTradeSnapshot } from './dark-trade-snapshot.entity';
import { Favorite } from '../favorites/favorite.entity';
import { DarkTradeController } from './darktrade.controller';
import { DarkTradeService } from './darktrade.service';

@Module({
  imports: [TypeOrmModule.forFeature([DarkTradeIndex, DarkTradeSnapshot, Favorite])],
  controllers: [DarkTradeController],
  providers: [DarkTradeService],
})
export class DarkTradeModule {}
