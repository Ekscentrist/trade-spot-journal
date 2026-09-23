import { createHmac } from 'node:crypto';

export const BITGET_REST_URL = 'https://api.bitget.com';

export type BitgetCredentials = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

export type BitgetRestJson<T = unknown> = {
  code?: string;
  msg?: string;
  data?: T;
  requestTime?: number;
};

export class BitgetApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BitgetApiError';
  }
}

export function signBitgetRest(
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

function isOkCode(code: unknown) {
  return String(code ?? '') === '00000' || String(code ?? '') === '0';
}

export async function bitgetRestRequest<T = unknown>(
  credentials: BitgetCredentials,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  restUrl = BITGET_REST_URL,
): Promise<T> {
  const bodyStr =
    method === 'POST' && body !== undefined ? JSON.stringify(body) : '';
  const timestamp = Date.now().toString();
  const sign = signBitgetRest(
    timestamp,
    method,
    path,
    bodyStr,
    credentials.secret,
  );

  const res = await fetch(`${restUrl}${path}`, {
    method,
    headers: {
      'ACCESS-KEY': credentials.apiKey,
      'ACCESS-SIGN': sign,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': credentials.passphrase,
      'Content-Type': 'application/json',
      locale: 'en-US',
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  let json: BitgetRestJson<T>;
  try {
    json = (await res.json()) as BitgetRestJson<T>;
  } catch {
    throw new BitgetApiError(
      `Bitget REST ${method} ${path} invalid JSON (${res.status})`,
    );
  }

  if (!res.ok || !isOkCode(json.code)) {
    throw new BitgetApiError(
      json.msg || `Bitget REST ${method} ${path} failed (${res.status})`,
      json.code,
    );
  }

  return json.data as T;
}

export {
  DUST_AMT,
  formatAmt,
  parseAmt,
  sleep,
} from '../okx/okx-rest.js';
