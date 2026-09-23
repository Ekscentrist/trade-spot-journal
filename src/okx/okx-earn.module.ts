import { Module, forwardRef } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { OkxEarnController } from './okx-earn.controller.js';
import { OkxEarnFundService } from './okx-earn-fund.service.js';

/** Isolated Earn transfers for stake/unstake + stables panel — no Orders dependency. */
@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [OkxEarnController],
  providers: [OkxEarnFundService],
  exports: [OkxEarnFundService],
})
export class OkxEarnModule {}
