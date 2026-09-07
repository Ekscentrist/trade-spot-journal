import { Logger } from '@nestjs/common';

const logger = new Logger('OkxTicker');
const CACHE_TTL_MS = 5_000;

type CacheEntry = {
  lastPx: number;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

async function fetchTickerLast(instId: string): Promise<number | null> {
  try {
    const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`Ticker HTTP ${res.status} for ${instId}`);
      return null;
    }
    const json = (await res.json()) as {
      code?: string;
      data?: Array<{ last?: string }>;
    };
    if (json.code !== '0' || !json.data?.[0]?.last) {
      logger.warn(`Ticker bad response for ${instId}: ${json.code}`);
      return null;
    }
    const last = Number(json.data[0].last);
    return Number.isFinite(last) && last > 0 ? last : null;
  } catch (error) {
    logger.warn(`Ticker fetch failed for ${instId}: ${(error as Error).message}`);
    return null;
  }
}

/** Fetch last prices for unique instruments with a short in-memory cache. */
export async function getLastPrices(
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
