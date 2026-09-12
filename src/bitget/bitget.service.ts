import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import WebSocket from 'ws';
import { OrdersService, type FillPayload } from '../orders/orders.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TelegramService } from '../telegram/telegram.service.js';

type ConnectionStatus = {
  connected: boolean;
  loggedIn: boolean;
  lastError: string | null;
  lastEventAt: string | null;
  reconnecting: boolean;
};

type BitgetOrderRaw = {
  orderId?: string;
  clientOid?: string;
  instId?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  status?: string;
  state?: string;
  price?: string;
  size?: string;
  fillPrice?: string;
  priceAvg?: string;
  accBaseVolume?: string;
  baseVolume?: string;
  fillFee?: string;
  fillFeeCoin?: string;
  feeDetail?: unknown;
  fillTime?: string;
  uTime?: string;
  cTime?: string;
};

const QUOTE_CCYS = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR'];

export function bitgetSymbolToInstId(symbol: string): string {
  if (symbol.includes('-')) return symbol.toUpperCase();
  const compact = symbol.toUpperCase().replace(/[_/]/g, '');
  const quotes = [...QUOTE_CCYS].sort((a, b) => b.length - a.length);
  for (const quote of quotes) {
    if (compact.endsWith(quote) && compact.length > quote.length) {
      return `${compact.slice(0, -quote.length)}-${quote}`;
    }
  }
  return compact;
}

function parseFee(item: BitgetOrderRaw): { fee?: string; feeCcy?: string } {
  if (item.fillFee) {
    return { fee: String(item.fillFee), feeCcy: item.fillFeeCoin };
  }

  const detail = item.feeDetail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
    const row = detail[0] as { fee?: string; feeCoin?: string };
    return {
      fee: row.fee != null ? String(row.fee) : undefined,
      feeCcy: row.feeCoin,
    };
  }

  if (typeof detail === 'string' && detail) {
    try {
      const parsed = JSON.parse(detail) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (key === 'newFees' || !value || typeof value !== 'object') continue;
        const row = value as {
          feeCoin?: string;
          totalFee?: number | string;
          fee?: number | string;
        };
        if (row.feeCoin) {
          const amount = row.totalFee ?? row.fee;
          return {
            fee: amount != null ? String(amount) : undefined,
            feeCcy: row.feeCoin,
          };
        }
      }
    } catch {
      // ignore malformed feeDetail
    }
  }

  return {};
}

function normalizeBitgetState(raw: string): string {
  const state = raw.trim().toLowerCase();
  if (state === 'partial_fill' || state === 'partiallyfilled') {
    return 'partially_filled';
  }
  if (state === 'full_fill' || state === 'full_filled' || state === 'fully_filled') {
    return 'filled';
  }
  return state;
}

function toFillPayload(item: BitgetOrderRaw): FillPayload | null {
  const ordId = String(item.orderId || '');
  const symbol = String(item.instId || item.symbol || '');
  if (!ordId || !symbol) return null;
  const { fee, feeCcy } = parseFee(item);
  return {
    ordId,
    clOrdId: item.clientOid,
    instId: bitgetSymbolToInstId(symbol),
    side: String(item.side || '').toLowerCase(),
    ordType: item.orderType,
    state: normalizeBitgetState(String(item.status || item.state || '')),
    px: item.price,
    sz: item.size,
    fillPx: item.fillPrice || item.priceAvg,
    avgPx: item.priceAvg || item.fillPrice,
    accFillSz: item.accBaseVolume || item.baseVolume,
    fee,
    feeCcy,
    fillTime: item.fillTime,
    uTime: item.uTime,
    cTime: item.cTime,
  };
}

function isFillState(state: string) {
  return state === 'filled' || state === 'partially_filled';
}

function isOkCode(code: unknown) {
  return String(code ?? '') === '0' || String(code ?? '') === '00000';
}

@Injectable()
export class BitgetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitgetService.name);
  private readonly wsUrl = 'wss://ws.bitget.com/v2/ws/private';
  private readonly restUrl = 'https://api.bitget.com';

  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private messageChain: Promise<void> = Promise.resolve();
  private status: ConnectionStatus = {
    connected: false,
    loggedIn: false,
    lastError: null,
    lastEventAt: null,
    reconnecting: false,
  };

  constructor(
    private readonly settingsService: SettingsService,
    private readonly ordersService: OrdersService,
    private readonly telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    this.stopped = false;
    await this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  getStatus() {
    return { ...this.status };
  }

  async reconnect() {
    this.stopped = false;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.status.reconnecting = true;
    await this.connect();
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.status.reconnecting = true;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 5000);
  }

  private async connect() {
    const settings = await this.settingsService.getRaw();
    if (
      !settings.bitgetApiKey ||
      !settings.bitgetSecret ||
      !settings.bitgetPassphrase
    ) {
      this.status = {
        connected: false,
        loggedIn: false,
        lastError: 'Bitget credentials are not configured',
        lastEventAt: this.status.lastEventAt,
        reconnecting: false,
      };
      this.logger.warn('Bitget credentials missing; skipping WS connect');
      return;
    }

    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
    }

    this.logger.log('Connecting to Bitget private WebSocket');
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.status.connected = true;
      this.status.reconnecting = false;
      this.status.lastError = null;
      this.login(
        settings.bitgetApiKey!,
        settings.bitgetSecret!,
        settings.bitgetPassphrase!,
      );
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 20000);
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      this.messageChain = this.messageChain
        .then(() => this.onMessage(text))
        .catch((error) => {
          this.logger.error(
            `Bitget message handler error: ${(error as Error).message}`,
          );
        });
    });

    ws.on('close', () => {
      this.status.connected = false;
      this.status.loggedIn = false;
      this.clearTimers();
      this.logger.warn('Bitget WS closed');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.status.lastError = err.message;
      this.logger.error(`Bitget WS error: ${err.message}`);
    });
  }

  private login(apiKey: string, secret: string, passphrase: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = createHmac('sha256', secret)
      .update(`${timestamp}GET/user/verify`)
      .digest('base64');

    this.ws?.send(
      JSON.stringify({
        op: 'login',
        args: [
          {
            apiKey,
            passphrase,
            timestamp,
            sign,
          },
        ],
      }),
    );
  }

  private subscribeOrders() {
    this.ws?.send(
      JSON.stringify({
        op: 'subscribe',
        args: [
          {
            instType: 'SPOT',
            channel: 'orders',
            instId: 'default',
          },
        ],
      }),
    );
  }

  private async onMessage(text: string) {
    if (text === 'pong') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    this.status.lastEventAt = new Date().toISOString();

    if (msg.event === 'login') {
      if (isOkCode(msg.code)) {
        this.status.loggedIn = true;
        this.status.lastError = null;
        this.logger.log('Bitget WS logged in');
        this.subscribeOrders();
        void this.syncRecentOrders().then(() => this.notifyPendingFills());
      } else {
        this.status.loggedIn = false;
        this.status.lastError = String(msg.msg || 'login failed');
        this.logger.error(`Bitget login failed: ${this.status.lastError}`);
      }
      return;
    }

    if (msg.event === 'subscribe') {
      this.logger.log(`Bitget subscribed: ${JSON.stringify(msg.arg || msg)}`);
      return;
    }

    if (msg.event === 'error') {
      this.status.lastError = String(msg.msg || 'bitget error');
      this.logger.error(`Bitget event error: ${this.status.lastError}`);
      return;
    }

    const arg = msg.arg as { channel?: string } | undefined;
    if (arg?.channel === 'orders' && Array.isArray(msg.data)) {
      for (const item of msg.data as BitgetOrderRaw[]) {
        try {
          await this.handleOrderUpdate(item);
        } catch (error) {
          this.logger.error(
            `Bitget order update failed: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  private async handleOrderUpdate(item: BitgetOrderRaw) {
    const payload = toFillPayload(item);
    if (!payload || !isFillState(payload.state)) return;

    const { order, shouldNotify } = await this.ordersService.upsertFill(
      'bitget',
      payload,
    );
    if (shouldNotify) {
      await this.notifyOrder(order);
    }
  }

  private async notifyOrder(order: {
    instId: string;
    side: string;
    state: string;
    ordType?: string | null;
    px?: string | null;
    avgPx?: string | null;
    fillPx?: string | null;
    sz?: string | null;
    accFillSz?: string | null;
    fee?: string | null;
    feeCcy?: string | null;
    ordId: string;
  }) {
    const ok = await this.telegramService.sendMessage(
      this.telegramService.formatOrderMessage(order, 'bitget'),
    );
    if (ok) {
      await this.ordersService.markNotified('bitget', order.ordId);
    }
  }

  private async notifyPendingFills() {
    try {
      const pending = await this.ordersService.listUnnotifiedFills('bitget');
      for (const order of pending) {
        await this.notifyOrder(order);
      }
      if (pending.length) {
        this.logger.log(
          `Bitget backfilled ${pending.length} Telegram notification(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Bitget pending notify failed: ${(error as Error).message}`,
      );
    }
  }

  private signRest(
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

  private async syncRecentOrders() {
    const settings = await this.settingsService.getRaw();
    if (
      !settings.bitgetApiKey ||
      !settings.bitgetSecret ||
      !settings.bitgetPassphrase
    ) {
      return;
    }

    const path = '/api/v2/spot/trade/history-orders?limit=50';
    const timestamp = Date.now().toString();
    const sign = this.signRest(
      timestamp,
      'GET',
      path,
      '',
      settings.bitgetSecret,
    );

    try {
      const res = await fetch(`${this.restUrl}${path}`, {
        headers: {
          'ACCESS-KEY': settings.bitgetApiKey,
          'ACCESS-SIGN': sign,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': settings.bitgetPassphrase,
          'Content-Type': 'application/json',
          locale: 'en-US',
        },
      });

      const json = (await res.json()) as {
        code?: string;
        msg?: string;
        data?: BitgetOrderRaw[];
      };

      if (!res.ok || json.code !== '00000') {
        this.logger.warn(
          `Bitget history sync failed: ${json.msg || res.statusText}`,
        );
        return;
      }

      for (const item of json.data || []) {
        const payload = toFillPayload(item);
        if (payload && isFillState(payload.state)) {
          await this.ordersService.upsertFill('bitget', payload);
        }
      }

      this.logger.log(
        `Bitget history sync done (${json.data?.length || 0} rows)`,
      );
    } catch (error) {
      this.logger.error(
        `Bitget history sync error: ${(error as Error).message}`,
      );
    }
  }
}
