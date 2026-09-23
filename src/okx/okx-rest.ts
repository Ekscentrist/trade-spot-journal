import { createHmac } from 'node:crypto';

export const OKX_REST_URL = 'https://www.okx.com';

export type OkxCredentials = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

export type OkxRestJson<T = unknown> = {
  code?: string;
  msg?: string;
  data?: T;
};

export class OkxApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OkxApiError';
  }
}

export function signOkxRest(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secret: string,
) {
  return createHmac('sha256', secret)
    .update(`${timestamp}${method}${path}${body}`)
    .digest('base64');
}

export async function okxRestRequest<T = unknown>(
  credentials: OkxCredentials,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  restUrl = OKX_REST_URL,
): Promise<T> {
  const bodyStr =
    method === 'POST' && body !== undefined ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const sign = signOkxRest(
    timestamp,
    method,
    path,
    bodyStr,
    credentials.secret,
  );

  const res = await fetch(`${restUrl}${path}`, {
    method,
    headers: {
      'OK-ACCESS-KEY': credentials.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': credentials.passphrase,
      'Content-Type': 'application/json',
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  let json: OkxRestJson<T>;
  try {
    json = (await res.json()) as OkxRestJson<T>;
  } catch {
    throw new OkxApiError(
      `OKX REST ${method} ${path} invalid JSON (${res.status})`,
    );
  }

  if (!res.ok || json.code !== '0') {
    throw new OkxApiError(
      json.msg || `OKX REST ${method} ${path} failed (${res.status})`,
      json.code,
    );
  }

  return (json.data ?? []) as T;
}

export function parseBaseCcy(instId: string): string {
  const base = instId.split('-')[0]?.trim();
  return base || instId;
}

export function parseAmt(value: string | null | undefined): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format amount for OKX REST without scientific notation.
 * Floors to `decimals` (default 8) to avoid "Insufficient balance" from float dust.
 */
export function formatAmt(value: number, decimals = 8): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const factor = 10 ** decimals;
  const floored = Math.floor(value * factor + 1e-12) / factor;
  if (floored <= 0) return '0';
  const fixed = floored.toFixed(decimals);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
}

export const DUST_AMT = 1e-8;

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
