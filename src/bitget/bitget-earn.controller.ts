import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { EarnDepositDto, EarnWithdrawDto } from './dto/earn-actions.dto.js';
import { BitgetEarnFundService } from './bitget-earn-fund.service.js';

@Controller('bitget/earn')
@UseGuards(JwtAuthGuard)
export class BitgetEarnController {
  constructor(private readonly bitgetEarnFundService: BitgetEarnFundService) {}

  @Get('balances')
  balances() {
    return this.bitgetEarnFundService.getStableBalances();
  }

  @Post('deposit')
  deposit(@Body() dto: EarnDepositDto) {
    return this.bitgetEarnFundService.depositAllSpot(dto.ccy);
  }

  @Post('withdraw')
  withdraw(@Body() dto: EarnWithdrawDto) {
    return this.bitgetEarnFundService.withdrawSpot(dto.ccy, dto.amt);
  }
}
