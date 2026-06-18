import { Module } from '@nestjs/common';
import { KlineModule } from '../kline/kline.module';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';

@Module({
  imports: [KlineModule],
  providers: [StrategyService],
  controllers: [StrategyController],
})
export class StrategyModule {}
