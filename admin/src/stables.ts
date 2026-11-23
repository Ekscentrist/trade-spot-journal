/** Stablecoin (quote currency) flow per order: what was actually spent or received. */

type FlowOrder = {
  sz?: string | null
  accFillSz?: string | null
  allocatedSz?: string | null
  px?: string | null
  avgPx?: string | null
  fillPx?: string | null
  fee?: string | null
  feeCcy?: string | null
}

function num(value?: string | null): number {
  if (value == null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function quoteOf(instId: string): string {
  return instId.split('-')[1] || 'USDT'
}

function priceOf(o: FlowOrder): number {
  return num(o.avgPx) || num(o.fillPx) || num(o.px)
}

function filledOf(o: FlowOrder): number {
  return num(o.accFillSz) || num(o.sz)
}

/** Fee paid in quote currency (0 when fee is in base or a third coin). */
function quoteFee(o: FlowOrder, quote: string): number {
  const ccy = (o.feeCcy || '').toUpperCase()
  if (!ccy || ccy !== quote.toUpperCase()) return 0
  return Math.abs(num(o.fee))
}

/** Quote spent on a buy: notional + fee when the fee was charged in quote. */
export function buySpent(o: FlowOrder, quote: string): number | null {
  const sz = filledOf(o)
  const px = priceOf(o)
  if (!sz || !px) return null
  return sz * px + quoteFee(o, quote)
}

/** Quote received on a sell (allocated part): notional − prorated quote fee. */
export function sellReceived(o: FlowOrder, quote: string): number | null {
  const filled = filledOf(o)
  const sz = num(o.allocatedSz) || filled
  const px = priceOf(o)
  if (!sz || !px) return null
  const share = filled > 0 ? Math.min(sz / filled, 1) : 1
  return sz * px - quoteFee(o, quote) * share
}

export function fmtQuote(value: number | null, quote: string): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6
  const str = value.toFixed(digits).replace(/\.?0+$/, '') || '0'
  return `${str} ${quote}`
}
