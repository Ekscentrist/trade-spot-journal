import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

const SETTING_KEYS = [
  'okxApiKey',
  'okxSecret',
  'okxPassphrase',
  'bitgetApiKey',
  'bitgetSecret',
  'bitgetPassphrase',
  'telegramBotToken',
  'telegramChatId',
] as const;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureRow() {
    const existing = await this.prisma.setting.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return this.prisma.setting.create({ data: { id: 1 } });
  }

  async getMasked() {
    const row = await this.ensureRow();
    return {
      okxApiKey: mask(row.okxApiKey),
      okxSecret: mask(row.okxSecret),
      okxPassphrase: mask(row.okxPassphrase),
      bitgetApiKey: mask(row.bitgetApiKey),
      bitgetSecret: mask(row.bitgetSecret),
      bitgetPassphrase: mask(row.bitgetPassphrase),
      telegramBotToken: mask(row.telegramBotToken),
      telegramChatId: row.telegramChatId,
      hasOkx: Boolean(row.okxApiKey && row.okxSecret && row.okxPassphrase),
      hasBitget: Boolean(
        row.bitgetApiKey && row.bitgetSecret && row.bitgetPassphrase,
      ),
      hasTelegram: Boolean(row.telegramBotToken && row.telegramChatId),
      updatedAt: row.updatedAt,
    };
  }

  async getRaw() {
    return this.ensureRow();
  }

  async update(dto: UpdateSettingsDto) {
    await this.ensureRow();
    const data: Record<string, string> = {};

    for (const key of SETTING_KEYS) {
      const value = dto[key];
      if (typeof value === 'string' && value.trim() !== '' && !value.includes('****')) {
        data[key] = value.trim();
      }
    }

    await this.prisma.setting.update({
      where: { id: 1 },
      data,
    });

    return this.getMasked();
  }
}
