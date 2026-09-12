import { Module } from '@nestjs/common';
import { BitgetModule } from '../bitget/bitget.module.js';
import { OkxModule } from '../okx/okx.module.js';
import { StatusController } from './status.controller.js';

@Module({
  imports: [OkxModule, BitgetModule],
  controllers: [StatusController],
})
export class StatusModule {}
