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
import { parseExchange, parseInstIds } from '../exchange.js';
import { LinkOrdersDto } from './dto/link-orders.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('instruments')
  instruments(@Query('exchange') exchange?: string) {
    return this.ordersService.listInstruments(parseExchange(exchange));
  }

  @Get('open')
  open(
    @Query('exchange') exchange?: string,
    @Query('instIds') instIds?: string | string[],
    @Query('side') side?: string,
  ) {
    return this.ordersService.listOpen({
      exchange: parseExchange(exchange),
      instIds: parseInstIds(instIds),
      side: side || undefined,
    });
  }

  @Get('mtm')
  mtm(
    @Query('exchange') exchange?: string,
    @Query('instIds') instIds?: string | string[],
  ) {
    return this.ordersService.listMtm({
      exchange: parseExchange(exchange),
      instIds: parseInstIds(instIds),
    });
  }

  @Get('staking')
  staking(
    @Query('exchange') exchange?: string,
    @Query('instIds') instIds?: string | string[],
  ) {
    return this.ordersService.listStaking({
      exchange: parseExchange(exchange),
      instIds: parseInstIds(instIds),
    });
  }

  @Get('staking/mtm')
  stakingMtm(
    @Query('exchange') exchange?: string,
    @Query('instIds') instIds?: string | string[],
  ) {
    return this.ordersService.listStakingMtm({
      exchange: parseExchange(exchange),
      instIds: parseInstIds(instIds),
    });
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
    @Query('exchange') exchange?: string,
    @Query('instIds') instIds?: string | string[],
    @Query('side') side?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.list({
      exchange: parseExchange(exchange),
      instIds: parseInstIds(instIds),
      side: side || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
