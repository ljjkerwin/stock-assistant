import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorRule } from './monitor-rule.entity';
import { MonitorMessage } from './monitor-message.entity';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { StocksModule } from '../stocks/stocks.module';
import { KlineModule } from '../kline/kline.module';

@Module({
  imports: [TypeOrmModule.forFeature([MonitorRule, MonitorMessage]), StocksModule, KlineModule],
  providers: [MonitorService],
  controllers: [MonitorController],
})
export class MonitorModule {}
