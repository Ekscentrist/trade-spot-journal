import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class LinkOrdersDto {
  @Type(() => Number)
  @IsInt()
  sellOrderId!: number;

  @Type(() => Number)
  @IsInt()
  buyOrderId!: number;
}
