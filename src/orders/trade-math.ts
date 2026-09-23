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

function hasFloatNoise(raw: string): boolean {
  const frac = raw.split('.')[1] || '';
  return /0{8,}[1-9]/.test(frac) || /9{8,}/.test(frac);
}

function trimDecimalZeros(raw: string): string {
  if (!raw.includes('.')) return raw === '-0' ? '0' : raw;
  const trimmed = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * Keep exchange decimals as written.
 * `Number(x).toFixed(16)` turns 4313.3 into 4313.3000000000001819 — drop that tail.
 */
export function cleanDecimal(value?: string | null): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^-?\d+(\.\d{1,12})?$/.test(raw) && !hasFloatNoise(raw)) {
    return trimDecimalZeros(raw);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return formatNum(n, 8);
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
