import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Exchange, parseExchange } from '../exchange.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getLastPrices } from './tickers.js';
import {
  CLOSE_THRESHOLD,
  calcOpenBuyMtm,
  calcRoundTrip,
  cleanDecimal,
  formatNum,
  orderSize,
  parseNum,
} from './trade-math.js';

export type FillPayload = {
  ordId: string;
  clOrdId?: string;
  instId: string;
  side: string;
  ordType?: string;
  state: string;
  px?: string;
  sz?: string;
  fillPx?: string;
  avgPx?: string;
  accFillSz?: string;
  fee?: string;
  feeCcy?: string;
  fillTime?: string;
  uTime?: string;
  cTime?: string;
};

/** @deprecated Use FillPayload */
export type OkxOrderPayload = FillPayload;

const orderSelect = {
  id: true,
  exchange: true,
  ordId: true,
  clOrdId: true,
  instId: true,
  side: true,
  ordType: true,
  state: true,
  px: true,
  sz: true,
  fillPx: true,
  avgPx: true,
  accFillSz: true,
  fee: true,
  feeCcy: true,
  filledAt: true,
  notifiedAt: true,
  matchedBuyId: true,
  allocatedSz: true,
  dealId: true,
  archivedAt: true,
  stakedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    exchange: Exchange;
    instIds?: string[];
    side?: string;
    limit?: number;
  }) {
    const take = Math.min(Math.max(params.limit ?? 100, 1), 500);
    const side =
      params.side === 'buy' || params.side === 'sell' ? params.side : undefined;
    const instIds = (params.instIds || []).filter(Boolean);

    return this.prisma.order.findMany({
      where: {
        exchange: params.exchange,
        ...(instIds.length ? { instId: { in: instIds } } : {}),
        ...(side ? { side } : {}),
        state: { in: ['filled', 'partially_filled'] },
      },
      orderBy: [{ filledAt: 'desc' }, { updatedAt: 'desc' }],
      take,
      select: orderSelect,
    });
  }

  async listInstruments(exchange: Exchange) {
    const rows = await this.prisma.order.findMany({
      where: {
        exchange,
        state: { in: ['filled', 'partially_filled'] },
      },
      distinct: ['instId'],
      select: { instId: true },
      orderBy: { instId: 'asc' },
    });
    return rows.map((row) => row.instId);
  }

  async listOpen(params: {
    exchange: Exchange;
    instIds?: string[];
    side?: string;
  }) {
    const instIds = (params.instIds || []).filter(Boolean);
    const side =
      params.side === 'buy' || params.side === 'sell' ? params.side : undefined;
    const exchange = params.exchange;

    const buys = await this.prisma.order.findMany({
      where: {
        exchange,
        side: 'buy',
        dealId: null,
        archivedAt: null,
        stakedAt: null,
        state: { in: ['filled', 'partially_filled'] },
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      orderBy: [{ filledAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        ...orderSelect,
        matchedSells: {
          where: { dealId: null, archivedAt: null },
          orderBy: [{ filledAt: 'asc' }, { id: 'asc' }],
          select: orderSelect,
        },
      },
    });

    const unlinkedSells = await this.prisma.order.findMany({
      where: {
        exchange,
        side: 'sell',
        dealId: null,
        matchedBuyId: null,
        archivedAt: null,
        state: { in: ['filled', 'partially_filled'] },
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      orderBy: [{ filledAt: 'desc' }, { updatedAt: 'desc' }],
      select: orderSelect,
    });

    const archivedSells = await this.prisma.order.findMany({
      where: {
        exchange,
        side: 'sell',
        dealId: null,
        matchedBuyId: null,
        archivedAt: { not: null },
        state: { in: ['filled', 'partially_filled'] },
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      orderBy: [{ archivedAt: 'desc' }, { id: 'desc' }],
      select: orderSelect,
    });

    const archivedBuys = await this.prisma.order.findMany({
      where: {
        exchange,
        side: 'buy',
        dealId: null,
        archivedAt: { not: null },
        stakedAt: null,
        state: { in: ['filled', 'partially_filled'] },
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      orderBy: [{ archivedAt: 'desc' }, { id: 'desc' }],
      select: orderSelect,
    });

    const prices = await getLastPrices(
      buys.map((buy) => buy.instId),
      exchange,
    );

    const openBuys = buys.map((buy) => {
      const lastPx = prices.get(buy.instId) ?? null;
      const stats = calcOpenBuyMtm({
        instId: buy.instId,
        buy,
        sells: buy.matchedSells,
        lastPx,
      });
      const partialPnl =
        stats.mtmPnl != null
          ? formatNum(stats.mtmPnl, 6)
          : formatNum(stats.pnl, 6);

      return {
        ...buy,
        soldSz: formatNum(stats.sellSz),
        remainingSz: formatNum(stats.remainingSz),
        coverage: stats.coverage,
        lastPx: stats.lastPx != null ? formatNum(stats.lastPx) : null,
        partialPnl,
        partialPnlIsMtm: stats.mtmPnl != null,
        quoteCcy: stats.quoteCcy,
      };
    });

    if (side === 'buy') {
      return {
        buys: openBuys,
        unlinkedSells: [],
        archivedSells: [],
        archivedBuys,
      };
    }
    if (side === 'sell') {
      return {
        buys: [],
        unlinkedSells,
        archivedSells,
        archivedBuys: [],
      };
    }
    return { buys: openBuys, unlinkedSells, archivedSells, archivedBuys };
  }

  async listMtm(params: {
    exchange: Exchange;
    instIds?: string[];
    staked?: boolean;
  }) {
    const instIds = (params.instIds || []).filter(Boolean);
    const staked = Boolean(params.staked);
    const exchange = params.exchange;

    const buys = await this.prisma.order.findMany({
      where: {
        exchange,
        side: 'buy',
        dealId: null,
        archivedAt: null,
        stakedAt: staked ? { not: null } : null,
        state: { in: ['filled', 'partially_filled'] },
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      select: {
        id: true,
        instId: true,
        avgPx: true,
        fillPx: true,
        px: true,
        sz: true,
        accFillSz: true,
        fee: true,
        feeCcy: true,
        matchedSells: {
          where: { dealId: null, archivedAt: null },
          select: {
            allocatedSz: true,
            avgPx: true,
            fillPx: true,
            px: true,
            sz: true,
            accFillSz: true,
            fee: true,
            feeCcy: true,
          },
        },
      },
    });

    const prices = await getLastPrices(
      buys.map((buy) => buy.instId),
      exchange,
    );
    const unrealizedByQuote = new Map<string, number>();

    const rows = buys.map((buy) => {
      const lastPx = prices.get(buy.instId) ?? null;
      const stats = calcOpenBuyMtm({
        instId: buy.instId,
        buy,
        sells: buy.matchedSells,
        lastPx,
      });
      const partialPnlIsMtm = stats.mtmPnl != null;
      const partialPnl =
        stats.mtmPnl != null
          ? formatNum(stats.mtmPnl, 6)
          : formatNum(stats.pnl, 6);

      if (partialPnlIsMtm && stats.mtmPnl != null) {
        const quote = stats.quoteCcy || 'USDT';
        unrealizedByQuote.set(
          quote,
          (unrealizedByQuote.get(quote) || 0) + stats.mtmPnl,
        );
      }

      return {
        id: buy.id,
        lastPx: stats.lastPx != null ? formatNum(stats.lastPx) : null,
        partialPnl,
        partialPnlIsMtm,
        quoteCcy: stats.quoteCcy,
        remainingSz: formatNum(stats.remainingSz),
        soldSz: formatNum(stats.sellSz),
        coverage: stats.coverage,
      };
    });

    return {
      buys: rows,
      unrealizedByQuote: [...unrealizedByQuote.entries()].map(
        ([quote, total]) => ({
          quote,
          total: formatNum(total, 6),
        }),
      ),
    };
  }

  async listStaking(params: { exchange: Exchange; instIds?: string[] }) {
    const instIds = (params.instIds || []).filter(Boolean);
    const exchange = params.exchange;

    const buys = await this.prisma.order.findMany({
      where: {
        exchange,
        side: 'buy',
        dealId: null,
        archivedAt: null,
        stakedAt: { not: null },
        state: { in: ['filled', 'partially_filled'] },
        ...(instIds.length ? { instId: { in: instIds } } : {}),
      },
      orderBy: [{ stakedAt: 'desc' }, { filledAt: 'desc' }],
      select: {
        ...orderSelect,
        matchedSells: {
          where: { dealId: null, archivedAt: null },
          orderBy: [{ filledAt: 'asc' }, { id: 'asc' }],
          select: orderSelect,
        },
      },
    });

    const prices = await getLastPrices(
      buys.map((buy) => buy.instId),
      exchange,
    );

    return buys.map((buy) => {
      const lastPx = prices.get(buy.instId) ?? null;
      const stats = calcOpenBuyMtm({
        instId: buy.instId,
        buy,
        sells: buy.matchedSells,
        lastPx,
      });
      const partialPnl =
        stats.mtmPnl != null
          ? formatNum(stats.mtmPnl, 6)
          : formatNum(stats.pnl, 6);

      return {
        ...buy,
        soldSz: formatNum(stats.sellSz),
        remainingSz: formatNum(stats.remainingSz),
        coverage: stats.coverage,
        lastPx: stats.lastPx != null ? formatNum(stats.lastPx) : null,
        partialPnl,
        partialPnlIsMtm: stats.mtmPnl != null,
        quoteCcy: stats.quoteCcy,
      };
    });
  }

  async listStakingMtm(params: { exchange: Exchange; instIds?: string[] }) {
    return this.listMtm({ ...params, staked: true });
  }

  async link(sellOrderId: number, buyOrderId: number) {
    const [sell, buy] = await Promise.all([
      this.prisma.order.findUnique({ where: { id: sellOrderId } }),
      this.prisma.order.findUnique({
        where: { id: buyOrderId },
        include: { matchedSells: true },
      }),
    ]);

    if (!sell || !buy) {
      throw new NotFoundException('Order not found');
    }
    if (sell.side !== 'sell') {
      throw new BadRequestException('Only sell orders can be dragged');
    }
    if (buy.side !== 'buy') {
      throw new BadRequestException('Target must be a buy order');
    }
    if (sell.exchange !== buy.exchange) {
      throw new BadRequestException('Sell and buy must be from the same exchange');
    }
    if (sell.dealId || buy.dealId) {
      throw new BadRequestException('Order already belongs to a closed deal');
    }
    if (sell.archivedAt) {
      throw new BadRequestException('Archived sell cannot be linked');
    }
    if (buy.archivedAt) {
      throw new BadRequestException('Archived buy cannot accept sells');
    }
    if (buy.stakedAt) {
      throw new BadRequestException('Unstake the buy before linking sells');
    }
    if (sell.matchedBuyId) {
      throw new BadRequestException('Sell is already linked');
    }
    if (sell.instId !== buy.instId) {
      throw new BadRequestException('Sell and buy must be the same instrument');
    }

    const sellSz = orderSize(sell);
    if (sellSz <= 0) {
      throw new BadRequestException('Sell size is empty');
    }

    const linkedSz = buy.matchedSells.reduce(
      (sum, item) => sum + (parseNum(item.allocatedSz) || orderSize(item)),
      0,
    );
    const buySz = orderSize(buy);
    if (linkedSz + sellSz > buySz + 1e-12) {
      throw new BadRequestException(
        `Sell size ${formatNum(sellSz)} exceeds remaining ${formatNum(buySz - linkedSz)}`,
      );
    }

    await this.prisma.order.update({
      where: { id: sell.id },
      data: {
        matchedBuyId: buy.id,
        allocatedSz: formatNum(sellSz),
      },
    });

    const deal = await this.maybeCloseBuy(buy.id);
    return {
      linked: true,
      dealCreated: Boolean(deal),
      deal,
      open: await this.listOpen({ exchange: parseExchange(buy.exchange) }),
    };
  }

  async unlink(sellOrderId: number) {
    const sell = await this.prisma.order.findUnique({
      where: { id: sellOrderId },
    });
    if (!sell) {
      throw new NotFoundException('Order not found');
    }
    if (sell.dealId) {
      throw new BadRequestException('Cannot unlink orders from a closed deal');
    }
    if (!sell.matchedBuyId) {
      throw new BadRequestException('Sell is not linked');
    }

    await this.prisma.order.update({
      where: { id: sell.id },
      data: { matchedBuyId: null, allocatedSz: null },
    });

    return {
      unlinked: true,
      open: await this.listOpen({ exchange: parseExchange(sell.exchange) }),
    };
  }

  async archive(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { matchedSells: { where: { dealId: null } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.side !== 'buy' && order.side !== 'sell') {
      throw new BadRequestException('Only buy/sell orders can be archived');
    }
    if (order.dealId) {
      throw new BadRequestException('Cannot archive an order from a closed deal');
    }
    if (order.side === 'sell' && order.matchedBuyId) {
      throw new BadRequestException('Unlink the sell before archiving');
    }
    if (order.side === 'buy' && order.matchedSells.length > 0) {
      throw new BadRequestException(
        'Unlink all sells from this buy before archiving',
      );
    }
    if (order.archivedAt) {
      throw new BadRequestException('Order is already archived');
    }
    if (order.stakedAt) {
      throw new BadRequestException('Unstake before archiving');
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { archivedAt: new Date() },
    });

    return {
      archived: true,
      open: await this.listOpen({ exchange: parseExchange(order.exchange) }),
    };
  }

  async unarchive(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!order.archivedAt) {
      throw new BadRequestException('Order is not archived');
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { archivedAt: null },
    });

    return {
      unarchived: true,
      open: await this.listOpen({ exchange: parseExchange(order.exchange) }),
    };
  }

  async stake(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.side !== 'buy') {
      throw new BadRequestException('Only buy orders can be staked');
    }
    if (order.dealId) {
      throw new BadRequestException('Cannot stake an order from a closed deal');
    }
    if (order.archivedAt) {
      throw new BadRequestException('Unarchive before staking');
    }
    if (order.stakedAt) {
      throw new BadRequestException('Buy is already staked');
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stakedAt: new Date() },
    });

    return {
      staked: true,
      open: await this.listOpen({ exchange: parseExchange(order.exchange) }),
    };
  }

  async unstake(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!order.stakedAt) {
      throw new BadRequestException('Buy is not staked');
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stakedAt: null },
    });

    const exchange = parseExchange(order.exchange);
    return {
      unstaked: true,
      open: await this.listOpen({ exchange }),
      staking: await this.listStaking({ exchange }),
    };
  }

  private async maybeCloseBuy(buyOrderId: number) {
    const buy = await this.prisma.order.findUnique({
      where: { id: buyOrderId },
      include: { matchedSells: true },
    });
    if (!buy || buy.dealId || buy.side !== 'buy') return null;

    const stats = calcRoundTrip({
      instId: buy.instId,
      buy,
      sells: buy.matchedSells,
    });

    if (stats.coverage < CLOSE_THRESHOLD) return null;

    const closedAt = new Date();
    const deal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          exchange: buy.exchange,
          instId: buy.instId,
          buyOrderId: buy.id,
          buySz: formatNum(stats.buySz),
          buyAvgPx: formatNum(stats.buyAvgPx),
          buyFee: buy.fee,
          buyFeeCcy: buy.feeCcy,
          sellSz: formatNum(stats.sellSz),
          sellAvgPx: formatNum(stats.sellAvgPx),
          sellFee: formatNum(stats.sellFeeQuote, 8),
          sellFeeCcy: stats.quoteCcy,
          pnl: formatNum(stats.pnl, 8),
          quoteCcy: stats.quoteCcy,
          closedAt,
        },
      });

      const orderIds = [buy.id, ...buy.matchedSells.map((s) => s.id)];
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { dealId: created.id },
      });

      return created;
    });

    return deal;
  }

  async upsertFill(exchange: Exchange, payload: FillPayload) {
    const filledAt = this.parseFillTime(
      payload.fillTime || payload.uTime || payload.cTime,
    );

    const data = {
      clOrdId: payload.clOrdId || null,
      instId: payload.instId,
      side: payload.side,
      ordType: payload.ordType || null,
      state: payload.state,
      px: cleanDecimal(payload.px),
      sz: cleanDecimal(payload.sz),
      fillPx: cleanDecimal(payload.fillPx),
      avgPx: cleanDecimal(payload.avgPx),
      accFillSz: cleanDecimal(payload.accFillSz),
      fee: cleanDecimal(payload.fee),
      feeCcy: payload.feeCcy || null,
      rawJson: payload as unknown as Prisma.InputJsonValue,
      filledAt,
    };

    const where = {
      exchange_ordId: { exchange, ordId: payload.ordId },
    };

    const existing = await this.prisma.order.findUnique({ where });

    let order;
    try {
      order = await this.prisma.order.upsert({
        where,
        create: { exchange, ordId: payload.ordId, ...data },
        update: data,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        order = await this.prisma.order.update({
          where,
          data,
        });
      } else {
        throw error;
      }
    }

    // Re-read after write so concurrent handlers see the latest notifiedAt.
    const latest = await this.prisma.order.findUnique({ where });
    const prior = existing ?? latest;
    const isFill =
      payload.state === 'filled' || payload.state === 'partially_filled';
    const stateChanged = !prior || prior.state !== payload.state;
    const fillIncreased =
      Boolean(prior) &&
      Boolean(payload.accFillSz) &&
      prior!.accFillSz !== payload.accFillSz;

    const shouldNotify =
      isFill &&
      (!latest?.notifiedAt || stateChanged || fillIncreased);

    return { order, shouldNotify, previous: existing };
  }

  async upsertFromOkx(payload: FillPayload) {
    return this.upsertFill('okx', payload);
  }

  async listUnnotifiedFills(exchange: Exchange) {
    return this.prisma.order.findMany({
      where: {
        exchange,
        notifiedAt: null,
        state: { in: ['filled', 'partially_filled'] },
      },
      orderBy: [{ filledAt: 'asc' }, { id: 'asc' }],
      select: orderSelect,
    });
  }

  async markNotified(exchange: Exchange, ordId: string) {
    return this.prisma.order.update({
      where: {
        exchange_ordId: { exchange, ordId },
      },
      data: { notifiedAt: new Date() },
    });
  }

  private parseFillTime(value?: string): Date | null {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return new Date(n);
  }
}
