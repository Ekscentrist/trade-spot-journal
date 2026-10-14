import { Module, forwardRef } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { GateService } from './gate.service.js';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => OrdersModule),
    forwardRef(() => TelegramModule),
  ],
  providers: [GateService],
  exports: [GateService],
})
export class GateModule {}
