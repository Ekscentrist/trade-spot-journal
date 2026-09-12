import { Module, forwardRef } from '@nestjs/common';
import { BitgetModule } from '../bitget/bitget.module.js';
import { OkxModule } from '../okx/okx.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [forwardRef(() => OkxModule), forwardRef(() => BitgetModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
