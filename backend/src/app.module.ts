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
      type: 'mysql',
      host: process.env.MYSQL_HOST,
      port: 3306,
      username: process.env.MYSQL_USERNAME,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      charset: 'utf8mb4',
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
