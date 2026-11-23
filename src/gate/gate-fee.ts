import { parseNum } from '../orders/trade-math.js';

export type GateFeeFields = {
  fee?: string | number | null;
  fee_currency?: string | null;
  gt_fee?: string | number | null;
  point_fee?: string | number | null;
};

/**
 * Gate charges the fee in one of three places:
 * - `fee` / `fee_currency` — regular fee (base on buys, quote on sells);
 * - `gt_fee` — paid in GT when "use GT for fees" is enabled (`fee` is then 0);
 * - `point_fee` — paid with POINT cards (1 POINT ≈ 1 USDT).
 */
export function parseGateFee(item: GateFeeFields): {
  fee?: string;
  feeCcy?: string;
} {
  if (Math.abs(parseNum(String(item.fee ?? ''))) > 0) {
    return { fee: String(item.fee), feeCcy: item.fee_currency || undefined };
  }
  if (Math.abs(parseNum(String(item.gt_fee ?? ''))) > 0) {
    return { fee: String(item.gt_fee), feeCcy: 'GT' };
  }
  if (Math.abs(parseNum(String(item.point_fee ?? ''))) > 0) {
    return { fee: String(item.point_fee), feeCcy: 'POINT' };
  }
  if (item.fee != null && item.fee !== '') {
    return { fee: String(item.fee), feeCcy: item.fee_currency || undefined };
  }
  return {};
}
