import { Type } from 'class-transformer';
import { IsIn, IsString } from 'class-validator';
import { STABLE_CCYS, WITHDRAW_AMTS } from '../okx-earn-fund.service.js';

export class EarnDepositDto {
  @IsString()
  @IsIn([...STABLE_CCYS])
  ccy!: (typeof STABLE_CCYS)[number];
}

export class EarnWithdrawDto {
  @IsString()
  @IsIn([...STABLE_CCYS])
  ccy!: (typeof STABLE_CCYS)[number];

  @Type(() => Number)
  @IsIn([...WITHDRAW_AMTS])
  amt!: (typeof WITHDRAW_AMTS)[number];
}
