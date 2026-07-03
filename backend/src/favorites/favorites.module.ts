import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Favorite } from './favorite.entity';
import { WatchList } from './watch-list.entity';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { WatchListsService } from './watch-lists.service';
import { WatchListsController } from './watch-lists.controller';
import { StocksModule } from '../stocks/stocks.module';
import { FundModule } from '../fund/fund.module';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, WatchList]), StocksModule, FundModule],
  providers: [FavoritesService, WatchListsService],
  controllers: [FavoritesController, WatchListsController],
  exports: [WatchListsService],
})
export class FavoritesModule {}
