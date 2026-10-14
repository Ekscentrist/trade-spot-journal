import { Logger } from '@nestjs/common';
import { instIdToGatePair } from '../gate/gate-rest.js';

const logger = new Logger('GateTicker');
const CACHE_TTL_MS = 5_000;

type CacheEntry = {
  lastPx: number;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

async function fetchTickerLast(instId: string): Promise<number | null> {
  try {
    const pair = instIdToGatePair(instId);
    const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`Ticker HTTP ${res.status} for ${instId}`);
      return null;
    }
    const json = (await res.json()) as Array<{ last?: string }>;
    const lastRaw = Array.isArray(json) ? json[0]?.last : undefined;
    if (!lastRaw) {
      logger.warn(`Ticker bad response for ${instId}`);
      return null;
    }
    const last = Number(lastRaw);
    return Number.isFinite(last) && last > 0 ? last : null;
  } catch (error) {
    logger.warn(`Ticker fetch failed for ${instId}: ${(error as Error).message}`);
    return null;
  }
}

export async function getGateLastPrices(
  instIds: string[],
): Promise<Map<string, number | null>> {
  const unique = [...new Set(instIds.filter(Boolean))];
  const result = new Map<string, number | null>();
  const now = Date.now();
  const toFetch: string[] = [];

  for (const instId of unique) {
    const hit = cache.get(instId);
    if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
      result.set(instId, hit.lastPx);
    } else {
      toFetch.push(instId);
    }
  }

  await Promise.all(
    toFetch.map(async (instId) => {
      const lastPx = await fetchTickerLast(instId);
      if (lastPx != null) {
        cache.set(instId, { lastPx, fetchedAt: Date.now() });
      }
      result.set(instId, lastPx);
    }),
  );

  return result;
}
