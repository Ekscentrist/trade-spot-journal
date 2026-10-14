import { createHash, createHmac } from 'node:crypto';

export const GATE_REST_URL = 'https://api.gateio.ws/api/v4';
export const GATE_WS_URL = 'wss://api.gateio.ws/ws/v4/';

export type GateCredentials = {
  apiKey: string;
  secret: string;
};

export function gatePairToInstId(pair: string): string {
  return pair.trim().toUpperCase().replace(/_/g, '-');
}

export function instIdToGatePair(instId: string): string {
  return instId.trim().toUpperCase().replace(/-/g, '_');
}

export class GateApiError extends Error {
  constructor(
    message: string,
    readonly label?: string,
  ) {
    super(message);
    this.name = 'GateApiError';
  }
}

export function signGateRest(
  method: string,
  urlPath: string,
  query: string,
  body: string,
  timestamp: string,
  secret: string,
) {
  const hashedPayload = createHash('sha512')
    .update(body || '')
    .digest('hex');
  const signString = `${method}\n${urlPath}\n${query}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signString).digest('hex');
}

export function signGateWs(
  channel: string,
  event: string,
  timestamp: number,
  secret: string,
) {
  const signString = `channel=${channel}&event=${event}&time=${timestamp}`;
  return createHmac('sha512', secret).update(signString).digest('hex');
}

function splitPath(pathWithQuery: string): { urlPath: string; query: string } {
  const q = pathWithQuery.indexOf('?');
  if (q === -1) {
    return { urlPath: `/api/v4${pathWithQuery}`, query: '' };
  }
  return {
    urlPath: `/api/v4${pathWithQuery.slice(0, q)}`,
    query: pathWithQuery.slice(q + 1),
  };
}

export async function gateRestRequest<T = unknown>(
  credentials: GateCredentials,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  restUrl = GATE_REST_URL,
): Promise<T> {
  const bodyStr =
    (method === 'POST' || method === 'PATCH') && body !== undefined
      ? JSON.stringify(body)
      : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const { urlPath, query } = splitPath(path);
  const sign = signGateRest(
    method,
    urlPath,
    query,
    bodyStr,
    timestamp,
    credentials.secret,
  );

  const res = await fetch(`${restUrl}${path}`, {
    method,
    headers: {
      KEY: credentials.apiKey,
      Timestamp: timestamp,
      SIGN: sign,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new GateApiError(
        `Gate REST ${method} ${path} invalid JSON (${res.status})`,
      );
    }
  }

  if (!res.ok) {
    const err = (json || {}) as { label?: string; message?: string };
    throw new GateApiError(
      err.message || `Gate REST ${method} ${path} failed (${res.status})`,
      err.label,
    );
  }

  return json as T;
}

export {
  DUST_AMT,
  formatAmt,
  parseAmt,
  sleep,
} from '../okx/okx-rest.js';
