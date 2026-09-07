import { Module, forwardRef } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TelegramService } from './telegram.service.js';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
