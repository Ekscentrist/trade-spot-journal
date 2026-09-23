import { Module } from '@nestjs/common';
import { BitgetEarnModule } from '../bitget/bitget-earn.module.js';
import { OkxEarnModule } from '../okx/okx-earn.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [OkxEarnModule, BitgetEarnModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
