import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { BitgetService } from './bitget.service.js';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    OrdersModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [BitgetService],
  exports: [BitgetService],
})
export class BitgetModule {}
