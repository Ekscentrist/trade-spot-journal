import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { LinkOrdersDto } from './dto/link-orders.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('instruments')
  instruments() {
    return this.ordersService.listInstruments();
  }

  @Get('open')
  open(
    @Query('instIds') instIds?: string | string[],
    @Query('side') side?: string,
  ) {
    const parsed = Array.isArray(instIds)
      ? instIds.flatMap((value) => value.split(','))
      : (instIds || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return this.ordersService.listOpen({
      instIds: parsed,
      side: side || undefined,
    });
  }

  @Get('mtm')
  mtm(@Query('instIds') instIds?: string | string[]) {
    const parsed = Array.isArray(instIds)
      ? instIds.flatMap((value) => value.split(','))
      : (instIds || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return this.ordersService.listMtm({ instIds: parsed });
  }

  @Get('staking')
  staking(@Query('instIds') instIds?: string | string[]) {
    const parsed = Array.isArray(instIds)
      ? instIds.flatMap((value) => value.split(','))
      : (instIds || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return this.ordersService.listStaking({ instIds: parsed });
  }

  @Get('staking/mtm')
  stakingMtm(@Query('instIds') instIds?: string | string[]) {
    const parsed = Array.isArray(instIds)
      ? instIds.flatMap((value) => value.split(','))
      : (instIds || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return this.ordersService.listStakingMtm({ instIds: parsed });
  }

  @Post('link')
  link(@Body() dto: LinkOrdersDto) {
    return this.ordersService.link(dto.sellOrderId, dto.buyOrderId);
  }

  @Delete('link/:sellOrderId')
  unlink(@Param('sellOrderId', ParseIntPipe) sellOrderId: number) {
    return this.ordersService.unlink(sellOrderId);
  }

  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.archive(id);
  }

  @Post(':id/unarchive')
  unarchive(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.unarchive(id);
  }

  @Post(':id/stake')
  stake(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.stake(id);
  }

  @Post(':id/unstake')
  unstake(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.unstake(id);
  }

  @Get()
  list(
    @Query('instIds') instIds?: string | string[],
    @Query('side') side?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Array.isArray(instIds)
      ? instIds.flatMap((value) => value.split(','))
      : (instIds || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return this.ordersService.list({
      instIds: parsed,
      side: side || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
