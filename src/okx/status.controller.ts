import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { OkxService } from './okx.service.js';

@Controller('status')
@UseGuards(JwtAuthGuard)
export class StatusController {
  constructor(private readonly okxService: OkxService) {}

  @Get()
  get() {
    return {
      okx: this.okxService.getStatus(),
    };
  }
}
