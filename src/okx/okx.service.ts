import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import WebSocket from 'ws';
import { OrdersService, OkxOrderPayload } from '../orders/orders.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { OkxEarnService } from './okx-earn.service.js';
import {
  OKX_REST_URL,
  okxRestRequest,
  parseBaseCcy,
} from './okx-rest.js';

type ConnectionStatus = {
  connected: boolean;
  loggedIn: boolean;
  lastError: string | null;
  lastEventAt: string | null;
  reconnecting: boolean;
};

@Injectable()
export class OkxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OkxService.name);
  private readonly wsUrl = 'wss://ws.okx.com:8443/ws/v5/private';
  private readonly restUrl = OKX_REST_URL;

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
    private readonly okxEarnService: OkxEarnService,
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
    if (!settings.okxApiKey || !settings.okxSecret || !settings.okxPassphrase) {
      this.status = {
        connected: false,
        loggedIn: false,
        lastError: 'OKX credentials are not configured',
        lastEventAt: this.status.lastEventAt,
        reconnecting: false,
      };
      this.logger.warn('OKX credentials missing; skipping WS connect');
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

    this.logger.log('Connecting to OKX private WebSocket');
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.status.connected = true;
      this.status.reconnecting = false;
      this.status.lastError = null;
      this.login(settings.okxApiKey!, settings.okxSecret!, settings.okxPassphrase!);
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
            `OKX message handler error: ${(error as Error).message}`,
          );
        });
    });

    ws.on('close', () => {
      this.status.connected = false;
      this.status.loggedIn = false;
      this.clearTimers();
      this.logger.warn('OKX WS closed');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.status.lastError = err.message;
      this.logger.error(`OKX WS error: ${err.message}`);
    });
  }

  private login(apiKey: string, secret: string, passphrase: string) {
    const timestamp = (Date.now() / 1000).toString();
    const sign = createHmac('sha256', secret)
      .update(`${timestamp}GET/users/self/verify`)
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
        args: [{ channel: 'orders', instType: 'SPOT' }],
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
      if (msg.code === '0') {
        this.status.loggedIn = true;
        this.status.lastError = null;
        this.logger.log('OKX WS logged in');
        this.subscribeOrders();
        void this.syncRecentOrders();
      } else {
        this.status.loggedIn = false;
        this.status.lastError = String(msg.msg || 'login failed');
        this.logger.error(`OKX login failed: ${this.status.lastError}`);
      }
      return;
    }

    if (msg.event === 'subscribe') {
      this.logger.log(`OKX subscribed: ${JSON.stringify(msg.arg || msg)}`);
      return;
    }

    if (msg.event === 'error') {
      this.status.lastError = String(msg.msg || 'okx error');
      this.logger.error(`OKX event error: ${this.status.lastError}`);
      return;
    }

    const arg = msg.arg as { channel?: string } | undefined;
    if (arg?.channel === 'orders' && Array.isArray(msg.data)) {
      for (const item of msg.data as OkxOrderPayload[]) {
        try {
          await this.handleOrderUpdate(item);
        } catch (error) {
          this.logger.error(
            `OKX order update failed: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  private async handleOrderUpdate(item: OkxOrderPayload) {
    if (!item?.ordId || !item.instId) return;
    if (item.state !== 'filled' && item.state !== 'partially_filled') {
      // keep only fill-related in DB for admin list
      return;
    }

    const { order, shouldNotify } = await this.ordersService.upsertFill(
      'okx',
      item,
    );
    if (!shouldNotify) return;

    const ok = await this.telegramService.sendMessage(
      this.telegramService.formatOrderMessage(order, 'okx'),
    );
    if (ok) {
      await this.ordersService.markNotified('okx', order.ordId);
    }

    // Live WS only — history sync must not trigger Earn/repay.
    // Delayed parallel jobs: deposit + settle independent after 3s.
    this.okxEarnService.scheduleAfterFill({
      side: order.side,
      ccy: parseBaseCcy(order.instId),
      ordId: order.ordId,
      fillSz: order.accFillSz ?? order.sz,
    });
  }

  private async syncRecentOrders() {
    const settings = await this.settingsService.getRaw();
    if (!settings.okxApiKey || !settings.okxSecret || !settings.okxPassphrase) {
      return;
    }

    const path = '/api/v5/trade/orders-history?instType=SPOT&limit=50';

    try {
      const data = await okxRestRequest<OkxOrderPayload[]>(
        {
          apiKey: settings.okxApiKey,
          secret: settings.okxSecret,
          passphrase: settings.okxPassphrase,
        },
        'GET',
        path,
        undefined,
        this.restUrl,
      );

      for (const item of data || []) {
        if (item.state === 'filled' || item.state === 'partially_filled') {
          // Persist only — Telegram/Earn are for live WS fills to avoid spam on restart.
          await this.ordersService.upsertFill('okx', item);
        }
      }

      this.logger.log(`OKX history sync done (${data?.length || 0} rows)`);
    } catch (error) {
      this.logger.error(`OKX history sync error: ${(error as Error).message}`);
    }
  }
}
