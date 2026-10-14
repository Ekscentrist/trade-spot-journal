import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { EarnDepositDto, EarnWithdrawDto } from './dto/earn-actions.dto.js';
import { GateEarnFundService } from './gate-earn-fund.service.js';

@Controller('gate/earn')
@UseGuards(JwtAuthGuard)
export class GateEarnController {
  constructor(private readonly gateEarnFundService: GateEarnFundService) {}

  @Get('balances')
  balances() {
    return this.gateEarnFundService.getStableBalances();
  }

  @Get('holdings')
  holdings() {
    return this.gateEarnFundService.getHoldings();
  }

  @Post('deposit')
  deposit(@Body() dto: EarnDepositDto) {
    return this.gateEarnFundService.depositAllSpot(dto.ccy);
  }

  @Post('withdraw')
  withdraw(@Body() dto: EarnWithdrawDto) {
    return this.gateEarnFundService.withdrawSpot(dto.ccy, dto.amt);
  }
}
