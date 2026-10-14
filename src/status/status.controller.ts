import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { BitgetService } from '../bitget/bitget.service.js';
import { GateService } from '../gate/gate.service.js';
import { OkxService } from '../okx/okx.service.js';

@Controller('status')
@UseGuards(JwtAuthGuard)
export class StatusController {
  constructor(
    private readonly okxService: OkxService,
    private readonly bitgetService: BitgetService,
    private readonly gateService: GateService,
  ) {}

  @Get()
  get() {
    return {
      okx: this.okxService.getStatus(),
      bitget: this.bitgetService.getStatus(),
      gate: this.gateService.getStatus(),
    };
  }
}
