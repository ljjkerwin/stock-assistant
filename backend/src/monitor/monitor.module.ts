import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorRule } from './monitor-rule.entity';
import { MonitorMessage } from './monitor-message.entity';
import { User } from '../auth/user.entity';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { EmailService } from './email.service';
import { StocksModule } from '../stocks/stocks.module';
import { KlineModule } from '../kline/kline.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MonitorRule, MonitorMessage, User]),
    StocksModule,
    KlineModule,
  ],
  providers: [MonitorService, EmailService],
  controllers: [MonitorController],
})
export class MonitorModule {}
