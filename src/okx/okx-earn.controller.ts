import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { EarnDepositDto, EarnWithdrawDto } from './dto/earn-actions.dto.js';
import { OkxEarnFundService } from './okx-earn-fund.service.js';

@Controller('okx/earn')
@UseGuards(JwtAuthGuard)
export class OkxEarnController {
  constructor(private readonly okxEarnFundService: OkxEarnFundService) {}

  @Get('balances')
  balances() {
    return this.okxEarnFundService.getStableBalances();
  }

  @Post('deposit')
  deposit(@Body() dto: EarnDepositDto) {
    return this.okxEarnFundService.depositAllSpot(dto.ccy);
  }

  @Post('withdraw')
  withdraw(@Body() dto: EarnWithdrawDto) {
    return this.okxEarnFundService.withdrawSpot(dto.ccy, dto.amt);
  }
}
