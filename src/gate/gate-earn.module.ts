import { Module, forwardRef } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { GateEarnController } from './gate-earn.controller.js';
import { GateEarnFundService } from './gate-earn-fund.service.js';

/** Isolated Earn transfers for stake/unstake + stables panel — no Orders dependency. */
@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [GateEarnController],
  providers: [GateEarnFundService],
  exports: [GateEarnFundService],
})
export class GateEarnModule {}
