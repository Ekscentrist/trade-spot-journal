import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import WebSocket from 'ws';
import { OrdersService, type FillPayload } from '../orders/orders.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import {
  GATE_REST_URL,
  GATE_WS_URL,
  type GateCredentials,
  gatePairToInstId,
  gateRestRequest,
  parseAmt,
  signGateWs,
} from './gate-rest.js';

type ConnectionStatus = {
  connected: boolean;
  loggedIn: boolean;
  lastError: string | null;
  lastEventAt: string | null;
  reconnecting: boolean;
};

type GateOrderRaw = {
  id?: string | number;
  text?: string;
  currency_pair?: string;
  side?: string;
  type?: string;
  status?: string;
  finish_as?: string;
  event?: string;
  amount?: string;
  left?: string;
  price?: string;
  filled_total?: string;
  filled_amount?: string;
  avg_deal_price?: string;
  fee?: string;
  fee_currency?: string;
  create_time?: string;
  create_time_ms?: string;
  update_time?: string;
  update_time_ms?: string;
};

function filledBase(item: GateOrderRaw): number {
  if (item.filled_amount != null && item.filled_amount !== '') {
    return parseAmt(item.filled_amount);
  }
  const amount = parseAmt(item.amount);
  const left = parseAmt(item.left);
  if (amount <= 0) return 0;
  return Math.max(amount - left, 0);
}

function normalizeGateState(item: GateOrderRaw): string {
  const finishAs = String(item.finish_as || item.status || '')
    .trim()
    .toLowerCase();
  if (finishAs === 'filled') return 'filled';

  const filled = filledBase(item);
  if (filled > 0 && (finishAs === 'open' || finishAs === '' || item.event === 'update')) {
    return 'partially_filled';
  }
  if (filled > 0 && finishAs === 'cancelled') {
    return 'partially_filled';
  }
  return finishAs || 'open';
}

function toFillPayload(item: GateOrderRaw): FillPayload | null {
  const ordId = String(item.id ?? '');
  const pair = String(item.currency_pair || '');
  if (!ordId || !pair) return null;

  const filled = filledBase(item);
  const avgPx = item.avg_deal_price;
  return {
    ordId,
    clOrdId: item.text,
    instId: gatePairToInstId(pair),
    side: String(item.side || '').toLowerCase(),
    ordType: item.type,
    state: normalizeGateState(item),
    px: item.price,
    sz: item.amount,
    fillPx: avgPx,
    avgPx,
    accFillSz: filled > 0 ? String(filled) : undefined,
    fee: item.fee,
    feeCcy: item.fee_currency,
    fillTime: item.update_time_ms || item.update_time,
    uTime: item.update_time_ms || item.update_time,
    cTime: item.create_time_ms || item.create_time,
  };
}

function isFillState(state: string) {
  return state === 'filled' || state === 'partially_filled';
}

@Injectable()
export class GateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GateService.name);
  private readonly wsUrl = GATE_WS_URL;
  private readonly restUrl = GATE_REST_URL;

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

  private async getCredentials(): Promise<GateCredentials | null> {
    const settings = await this.settingsService.getRaw();
    if (!settings.gateApiKey || !settings.gateSecret) return null;
    return {
      apiKey: settings.gateApiKey,
      secret: settings.gateSecret,
    };
  }

  private async connect() {
    const credentials = await this.getCredentials();
    if (!credentials) {
      this.status = {
        connected: false,
        loggedIn: false,
        lastError: 'Gate credentials are not configured',
        lastEventAt: this.status.lastEventAt,
        reconnecting: false,
      };
      this.logger.warn('Gate credentials missing; skipping WS connect');
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

    this.logger.log('Connecting to Gate private WebSocket');
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.status.connected = true;
      this.status.reconnecting = false;
      this.status.lastError = null;
      this.subscribeOrders(credentials);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const time = Math.floor(Date.now() / 1000);
          ws.send(JSON.stringify({ time, channel: 'spot.ping' }));
        }
      }, 15000);
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      this.messageChain = this.messageChain
        .then(() => this.onMessage(text, credentials))
        .catch((error) => {
          this.logger.error(
            `Gate message handler error: ${(error as Error).message}`,
          );
        });
    });

    ws.on('close', () => {
      this.status.connected = false;
      this.status.loggedIn = false;
      this.clearTimers();
      this.logger.warn('Gate WS closed');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.status.lastError = err.message;
      this.logger.error(`Gate WS error: ${err.message}`);
    });
  }

  private subscribeOrders(credentials: GateCredentials) {
    const time = Math.floor(Date.now() / 1000);
    const channel = 'spot.orders';
    const event = 'subscribe';
    const sign = signGateWs(channel, event, time, credentials.secret);
    this.ws?.send(
      JSON.stringify({
        time,
        channel,
        event,
        payload: ['!all'],
        auth: {
          method: 'api_key',
          KEY: credentials.apiKey,
          SIGN: sign,
        },
      }),
    );
  }

  private async onMessage(text: string, credentials: GateCredentials) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    this.status.lastEventAt = new Date().toISOString();
    const channel = String(msg.channel || '');
    const event = String(msg.event || '');

    if (channel === 'spot.pong' || channel === 'spot.ping') return;

    if (channel === 'spot.orders' && event === 'subscribe') {
      const err = msg.error as { message?: string } | undefined;
      if (err?.message) {
        this.status.loggedIn = false;
        this.status.lastError = err.message;
        this.logger.error(`Gate subscribe failed: ${err.message}`);
        return;
      }
      this.status.loggedIn = true;
      this.status.lastError = null;
      this.logger.log('Gate WS subscribed to spot.orders');
      void this.syncRecentOrders(credentials).then(() =>
        this.notifyPendingFills(),
      );
      return;
    }

    if (event === 'error' || msg.error) {
      const err = (msg.error || {}) as { message?: string };
      this.status.lastError = String(err.message || msg.message || 'gate error');
      this.logger.error(`Gate event error: ${this.status.lastError}`);
      return;
    }

    if (channel === 'spot.orders' && event === 'update') {
      const rows = Array.isArray(msg.result)
        ? (msg.result as GateOrderRaw[])
        : [];
      for (const item of rows) {
        try {
          await this.handleOrderUpdate(item);
        } catch (error) {
          this.logger.error(
            `Gate order update failed: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  private async handleOrderUpdate(item: GateOrderRaw) {
    const payload = toFillPayload(item);
    if (!payload || !isFillState(payload.state)) return;

    const { order, shouldNotify } = await this.ordersService.upsertFill(
      'gate',
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
      this.telegramService.formatOrderMessage(order, 'gate'),
    );
    if (ok) {
      await this.ordersService.markNotified('gate', order.ordId);
    }
  }

  private async notifyPendingFills() {
    try {
      const pending = await this.ordersService.listUnnotifiedFills('gate');
      for (const order of pending) {
        await this.notifyOrder(order);
      }
      if (pending.length) {
        this.logger.log(
          `Gate backfilled ${pending.length} Telegram notification(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Gate pending notify failed: ${(error as Error).message}`,
      );
    }
  }

  private async syncRecentOrders(credentials: GateCredentials) {
    try {
      const rows = await gateRestRequest<GateOrderRaw[]>(
        credentials,
        'GET',
        '/spot/orders?status=finished&limit=50',
        undefined,
        this.restUrl,
      );

      for (const item of Array.isArray(rows) ? rows : []) {
        const payload = toFillPayload(item);
        if (payload && isFillState(payload.state)) {
          await this.ordersService.upsertFill('gate', payload);
        }
      }

      this.logger.log(
        `Gate history sync done (${Array.isArray(rows) ? rows.length : 0} rows)`,
      );
    } catch (error) {
      this.logger.error(
        `Gate history sync error: ${(error as Error).message}`,
      );
    }
  }
}
