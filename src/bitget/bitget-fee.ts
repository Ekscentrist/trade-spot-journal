import { parseNum } from '../orders/trade-math.js';

export type BitgetFeeFields = {
  side?: string;
  fillFee?: string | number | null;
  fillFeeCoin?: string | null;
  feeDetail?: unknown;
};

type FeeRow = {
  feeCoin?: string;
  feeCoinCode?: string;
  fee?: number | string;
  totalFee?: number | string;
  t?: number | string;
};

function nonZero(value: unknown): boolean {
  return value != null && Math.abs(parseNum(String(value))) > 0;
}

function rowAmount(row: FeeRow): number | string | undefined {
  if (nonZero(row.totalFee)) return row.totalFee;
  if (nonZero(row.fee)) return row.fee;
  return row.totalFee ?? row.fee;
}

/**
 * Bitget reports the order's total fee in `feeDetail` (negative numbers):
 * - WS `orders` channel: `[{ feeCoin, fee }]`;
 * - REST orderInfo / history-orders: JSON string
 *   `{"newFees":{"t":-1,...},"TRX":{"feeCoinCode":"TRX","totalFee":-1}}`;
 * - REST fills: `{ feeCoin, totalFee }`.
 * `fillFee` (WS) may be the last trade's fee only, so it is a fallback.
 */
export function parseBitgetFee(
  item: BitgetFeeFields,
  instId: string,
): { fee?: string; feeCcy?: string } {
  let detail: unknown = item.feeDetail;
  if (typeof detail === 'string' && detail) {
    try {
      detail = JSON.parse(detail);
    } catch {
      detail = undefined;
    }
  }

  const rows: Array<{ coin?: string; amount?: number | string }> = [];
  let newFeesTotal: number | string | undefined;

  if (Array.isArray(detail)) {
    for (const raw of detail) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as FeeRow;
      rows.push({
        coin: row.feeCoin || row.feeCoinCode,
        amount: rowAmount(row),
      });
    }
  } else if (detail && typeof detail === 'object') {
    const obj = detail as Record<string, unknown>;
    if ('feeCoin' in obj || 'totalFee' in obj) {
      const row = obj as FeeRow;
      rows.push({
        coin: row.feeCoin || row.feeCoinCode,
        amount: rowAmount(row),
      });
    } else {
      for (const [key, value] of Object.entries(obj)) {
        if (!value || typeof value !== 'object') continue;
        const row = value as FeeRow;
        if (key === 'newFees') {
          newFeesTotal = row.t;
          continue;
        }
        rows.push({
          coin: row.feeCoinCode || row.feeCoin || key,
          amount: rowAmount(row),
        });
      }
    }
  }

  const hit = rows.find((r) => r.coin && nonZero(r.amount));
  if (hit) return { fee: String(hit.amount), feeCcy: hit.coin };

  if (nonZero(newFeesTotal)) {
    const [base, quote] = instId.split('-');
    const side = String(item.side || '').toLowerCase();
    return {
      fee: String(newFeesTotal),
      feeCcy: side === 'buy' ? base : quote,
    };
  }

  if (nonZero(item.fillFee)) {
    return {
      fee: String(item.fillFee),
      feeCcy: item.fillFeeCoin || undefined,
    };
  }

  const zero = rows.find((r) => r.coin && r.amount != null);
  if (zero) return { fee: String(zero.amount), feeCcy: zero.coin };
  return {};
}
