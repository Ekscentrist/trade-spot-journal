export const EXCHANGES = ['okx', 'bitget', 'gate'] as const;
export type Exchange = (typeof EXCHANGES)[number];
export const DEFAULT_EXCHANGE: Exchange = 'okx';

const LABELS: Record<Exchange, string> = {
  okx: 'OKX',
  bitget: 'Bitget',
  gate: 'Gate',
};

function isExchange(value: string): value is Exchange {
  return (EXCHANGES as readonly string[]).includes(value);
}

export function parseExchange(value?: string | string[] | null): Exchange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && isExchange(raw)) return raw;
  return DEFAULT_EXCHANGE;
}

export function exchangeLabel(exchange: Exchange): string {
  return LABELS[exchange];
}

export function parseInstIds(instIds?: string | string[]): string[] {
  const list = Array.isArray(instIds)
    ? instIds.flatMap((value) => value.split(','))
    : (instIds || '').split(',');
  return list.map((value) => value.trim()).filter(Boolean);
}
