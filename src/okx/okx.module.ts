import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { OkxService } from './okx.service.js';
import { StatusController } from './status.controller.js';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    OrdersModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [StatusController],
  providers: [OkxService],
  exports: [OkxService],
})
export class OkxModule {}
