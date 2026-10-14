import { Module, forwardRef } from '@nestjs/common';
import { BitgetModule } from '../bitget/bitget.module.js';
import { GateModule } from '../gate/gate.module.js';
import { OkxModule } from '../okx/okx.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [
    forwardRef(() => OkxModule),
    forwardRef(() => BitgetModule),
    forwardRef(() => GateModule),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
