import { Module } from '@nestjs/common';
import { KlineService } from './kline.service';
import { KlineController } from './kline.controller';

@Module({
  providers: [KlineService],
  controllers: [KlineController],
  exports: [KlineService],
})
export class KlineModule {}
