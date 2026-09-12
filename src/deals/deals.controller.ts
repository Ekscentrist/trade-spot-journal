import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { parseExchange, parseInstIds } from '../exchange.js';
import { DealsService } from './deals.service.js';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Get('instruments')
  instruments(@Query('exchange') exchange?: string) {
    return this.dealsService.listInstruments(parseExchange(exchange));
  }

  @Get()
  list(
    @Query('exchange') exchange?: string,
    @Query('instIds') instIds?: string | string[],
    @Query('limit') limit?: string,
  ) {
    return this.dealsService.list({
      exchange: parseExchange(exchange),
      instIds: parseInstIds(instIds),
      limit: limit ? Number(limit) : undefined,
    });
  }
}
