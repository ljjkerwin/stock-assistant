import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Favorite } from './favorite.entity';
import { WatchList } from './watch-list.entity';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { WatchListsService } from './watch-lists.service';
import { WatchListsController } from './watch-lists.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, WatchList])],
  providers: [FavoritesService, WatchListsService],
  controllers: [FavoritesController, WatchListsController],
  exports: [WatchListsService],
})
export class FavoritesModule {}
