import { Injectable, Logger } from '@nestjs/common';
import { type Exchange, exchangeLabel } from '../exchange.js';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly settingsService: SettingsService) {}

  async sendMessage(text: string): Promise<boolean> {
    const settings = await this.settingsService.getRaw();
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      this.logger.warn('Telegram is not configured');
      return false;
    }

    const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text,
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Telegram send failed: ${res.status} ${body}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Telegram send error: ${(error as Error).message}`);
      return false;
    }
  }

  formatOrderMessage(
    order: {
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
    },
    exchange: Exchange = 'okx',
  ) {
    const price = order.avgPx || order.fillPx || order.px || '-';
    const size = order.accFillSz || order.sz || '-';
    const fee =
      order.fee && order.feeCcy
        ? `${order.fee} ${order.feeCcy}`
        : order.fee || '-';

    return [
      `${exchangeLabel(exchange)} Spot ${order.state.toUpperCase()}`,
      `${order.side.toUpperCase()} ${order.instId}`,
      `Type: ${order.ordType || '-'}`,
      `Size: ${size}`,
      `Price: ${price}`,
      `Fee: ${fee}`,
      `Order: ${order.ordId}`,
    ].join('\n');
  }
}
