import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { OkxEarnService } from './okx-earn.service.js';
import { OkxService } from './okx.service.js';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    OrdersModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [OkxService, OkxEarnService],
  exports: [OkxService, OkxEarnService],
})
export class OkxModule {}
