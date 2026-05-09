import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoritesModule } from './favorites/favorites.module';
import { StocksModule } from './stocks/stocks.module';
import { KlineModule } from './kline/kline.module';
import { Favorite } from './favorites/favorite.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'stock-assistant.db',
      entities: [Favorite],
      synchronize: true,
    }),
    FavoritesModule,
    StocksModule,
    KlineModule,
  ],
})
export class AppModule {}
