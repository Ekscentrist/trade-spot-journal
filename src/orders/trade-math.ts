export const CLOSE_THRESHOLD = 0.99;

export function parseNum(value?: string | null): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function orderSize(order: {
  accFillSz?: string | null;
  sz?: string | null;
}): number {
  return parseNum(order.accFillSz) || parseNum(order.sz);
}

export function orderPrice(order: {
  avgPx?: string | null;
  fillPx?: string | null;
  px?: string | null;
}): number {
  return parseNum(order.avgPx) || parseNum(order.fillPx) || parseNum(order.px);
}

export function quoteCurrency(instId: string): string {
  const parts = instId.split('-');
  return parts[1] || 'USDT';
}

export function baseCurrency(instId: string): string {
  return instId.split('-')[0] || '';
}

/** Convert fee amount into quote currency using trade price when fee is in base. */
export function feeInQuote(
  fee: string | null | undefined,
  feeCcy: string | null | undefined,
  instId: string,
  price: number,
): number {
  const amount = Math.abs(parseNum(fee));
  if (!amount) return 0;
  const quote = quoteCurrency(instId);
  const base = baseCurrency(instId);
  const ccy = (feeCcy || quote).toUpperCase();
  if (ccy === quote.toUpperCase()) return amount;
  if (ccy === base.toUpperCase()) return amount * price;
  // Unknown fee currency — treat as quote to avoid ignoring costs entirely.
  return amount;
}

export function formatNum(value: number, digits = 8): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.?0+$/, '') || '0';
}

export type PnlParts = {
  buySz: number;
  buyAvgPx: number;
  buyNotional: number;
  buyFeeQuote: number;
  sellSz: number;
  sellAvgPx: number;
  sellNotional: number;
  sellFeeQuote: number;
  feesQuote: number;
  pnl: number;
  coverage: number;
  quoteCcy: string;
};

export function calcRoundTrip(params: {
  instId: string;
  buy: {
    accFillSz?: string | null;
    sz?: string | null;
    avgPx?: string | null;
    fillPx?: string | null;
    px?: string | null;
    fee?: string | null;
    feeCcy?: string | null;
  };
  sells: Array<{
    accFillSz?: string | null;
    sz?: string | null;
    allocatedSz?: string | null;
    avgPx?: string | null;
    fillPx?: string | null;
    px?: string | null;
    fee?: string | null;
    feeCcy?: string | null;
  }>;
}): PnlParts {
  const buySz = orderSize(params.buy);
  const buyAvgPx = orderPrice(params.buy);
  const buyNotional = buySz * buyAvgPx;
  const buyFeeQuote = feeInQuote(
    params.buy.fee,
    params.buy.feeCcy,
    params.instId,
    buyAvgPx,
  );

  let sellSz = 0;
  let sellNotional = 0;
  let sellFeeQuote = 0;

  for (const sell of params.sells) {
    const sz = parseNum(sell.allocatedSz) || orderSize(sell);
    const px = orderPrice(sell);
    sellSz += sz;
    sellNotional += sz * px;
    sellFeeQuote += feeInQuote(sell.fee, sell.feeCcy, params.instId, px);
  }

  const sellAvgPx = sellSz > 0 ? sellNotional / sellSz : 0;
  const feesQuote = buyFeeQuote + sellFeeQuote;
  const pnl = sellNotional - buyNotional - feesQuote;
  const coverage = buySz > 0 ? sellSz / buySz : 0;

  return {
    buySz,
    buyAvgPx,
    buyNotional,
    buyFeeQuote,
    sellSz,
    sellAvgPx,
    sellNotional,
    sellFeeQuote,
    feesQuote,
    pnl,
    coverage,
    quoteCcy: quoteCurrency(params.instId),
  };
}

export type OpenBuyMtm = PnlParts & {
  remainingSz: number;
  lastPx: number | null;
  mtmPnl: number | null;
};

/** Mark-to-market PnL for an open buy using last market price for unsold size. */
export function calcOpenBuyMtm(params: {
  instId: string;
  buy: Parameters<typeof calcRoundTrip>[0]['buy'];
  sells: Parameters<typeof calcRoundTrip>[0]['sells'];
  lastPx: number | null;
}): OpenBuyMtm {
  const base = calcRoundTrip(params);
  const remainingSz = Math.max(base.buySz - base.sellSz, 0);

  if (params.lastPx == null || !Number.isFinite(params.lastPx) || params.lastPx <= 0) {
    return {
      ...base,
      remainingSz,
      lastPx: null,
      mtmPnl: null,
    };
  }

  const mtmValue = base.sellNotional + remainingSz * params.lastPx;
  const mtmPnl = mtmValue - base.buyNotional - base.feesQuote;

  return {
    ...base,
    remainingSz,
    lastPx: params.lastPx,
    mtmPnl,
  };
}
