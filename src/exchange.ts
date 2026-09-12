export const EXCHANGES = ['okx', 'bitget'] as const;
export type Exchange = (typeof EXCHANGES)[number];
export const DEFAULT_EXCHANGE: Exchange = 'okx';

export function parseExchange(value?: string | string[] | null): Exchange {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'bitget' ? 'bitget' : DEFAULT_EXCHANGE;
}

export function exchangeLabel(exchange: Exchange): string {
  return exchange === 'bitget' ? 'Bitget' : 'OKX';
}

export function parseInstIds(instIds?: string | string[]): string[] {
  const list = Array.isArray(instIds)
    ? instIds.flatMap((value) => value.split(','))
    : (instIds || '').split(',');
  return list.map((value) => value.trim()).filter(Boolean);
}
