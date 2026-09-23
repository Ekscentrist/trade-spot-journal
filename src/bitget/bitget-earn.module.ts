import { Module, forwardRef } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { BitgetEarnController } from './bitget-earn.controller.js';
import { BitgetEarnFundService } from './bitget-earn-fund.service.js';

/** Isolated Earn transfers for stake/unstake + stables panel — no Orders dependency. */
@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [BitgetEarnController],
  providers: [BitgetEarnFundService],
  exports: [BitgetEarnFundService],
})
export class BitgetEarnModule {}
