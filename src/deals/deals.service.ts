import { Injectable } from '@nestjs/common';
import { type Exchange } from '../exchange.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    exchange: Exchange;
    instIds?: string[];
    limit?: number;
  }) {
    const take = Math.min(Math.max(params.limit ?? 100, 1), 500);
    const instIds = (params.instIds || []).filter(Boolean);

    return this.prisma.deal.findMany({
      where: {
        exchange: params.exchange,
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        buyOrder: {
          select: {
            id: true,
            ordId: true,
            filledAt: true,
          },
        },
        orders: {
          where: { side: 'sell' },
          select: {
            id: true,
            ordId: true,
            allocatedSz: true,
            avgPx: true,
            fillPx: true,
            fee: true,
            feeCcy: true,
            filledAt: true,
          },
          orderBy: [{ filledAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }

  async listInstruments(exchange: Exchange) {
    const rows = await this.prisma.deal.findMany({
      where: { exchange },
      distinct: ['instId'],
      select: { instId: true },
      orderBy: { instId: 'asc' },
    });
    return rows.map((row) => row.instId);
  }
}
