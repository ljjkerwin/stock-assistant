import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoritesModule } from './favorites/favorites.module';
import { StocksModule } from './stocks/stocks.module';
import { KlineModule } from './kline/kline.module';
import { MonitorModule } from './monitor/monitor.module';
import { Favorite } from './favorites/favorite.entity';
import { MonitorRule } from './monitor/monitor-rule.entity';
import { MonitorMessage } from './monitor/monitor-message.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'stock-assistant.db',
      entities: [Favorite, MonitorRule, MonitorMessage],
      synchronize: true,
    }),
    FavoritesModule,
    StocksModule,
    KlineModule,
    MonitorModule,
  ],
})
export class AppModule {}
