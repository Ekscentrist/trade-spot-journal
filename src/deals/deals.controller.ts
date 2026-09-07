import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { DealsService } from './deals.service.js';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Get('instruments')
  instruments() {
    return this.dealsService.listInstruments();
  }

  @Get()
  list(
    @Query('instIds') instIds?: string | string[],
    @Query('limit') limit?: string,
  ) {
    const parsed = Array.isArray(instIds)
      ? instIds.flatMap((value) => value.split(','))
      : (instIds || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return this.dealsService.list({
      instIds: parsed,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
