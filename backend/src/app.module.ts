import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { FavoritesModule } from './favorites/favorites.module';
import { StocksModule } from './stocks/stocks.module';
import { KlineModule } from './kline/kline.module';
import { MonitorModule } from './monitor/monitor.module';
import { FundModule } from './fund/fund.module';
import { StrategyModule } from './strategy/strategy.module';
import { Favorite } from './favorites/favorite.entity';
import { WatchList } from './favorites/watch-list.entity';
import { MonitorRule } from './monitor/monitor-rule.entity';
import { MonitorMessage } from './monitor/monitor-message.entity';
import { TestModule } from './test/test.module';

const entities = [Favorite, WatchList, MonitorRule, MonitorMessage];

function buildDataSourceOptions(): DataSourceOptions {
  const { MYSQL_HOST, MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
  if (MYSQL_HOST && MYSQL_USERNAME && MYSQL_PASSWORD) {
    return {
      type: 'mysql',
      host: MYSQL_HOST,
      port: 3306,
      username: MYSQL_USERNAME,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      charset: 'utf8mb4',
      entities,
      synchronize: true,
    };
  }
  return {
    type: 'better-sqlite3',
    database: './stock-assistant.db',
    entities,
    synchronize: true,
  };
}

@Module({
  imports: [
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    FavoritesModule,
    StocksModule,
    KlineModule,
    MonitorModule,
    FundModule,
    StrategyModule,
    TestModule,
  ],
})
export class AppModule {}
