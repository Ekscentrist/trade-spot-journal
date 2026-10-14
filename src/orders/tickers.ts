import type { Exchange } from '../exchange.js';
import { getBitgetLastPrices } from './bitget-ticker.js';
import { getGateLastPrices } from './gate-ticker.js';
import { getLastPrices as getOkxLastPrices } from './okx-ticker.js';

export async function getLastPrices(
  instIds: string[],
  exchange: Exchange,
): Promise<Map<string, number | null>> {
  if (exchange === 'bitget') {
    return getBitgetLastPrices(instIds);
  }
  if (exchange === 'gate') {
    return getGateLastPrices(instIds);
  }
  return getOkxLastPrices(instIds);
}
