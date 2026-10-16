import { IsIn, IsString } from 'class-validator';
import { EXCHANGES } from '../../exchange.js';

export class ChangeExchangeDto {
  @IsString()
  @IsIn([...EXCHANGES])
  exchange!: (typeof EXCHANGES)[number];
}
