import { Module, forwardRef } from '@nestjs/common';
import { OkxModule } from '../okx/okx.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [forwardRef(() => OkxModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
