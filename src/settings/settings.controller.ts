import {
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Query,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { BitgetService } from '../bitget/bitget.service.js';
import { parseExchange } from '../exchange.js';
import { OkxService } from '../okx/okx.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => OkxService))
    private readonly okxService: OkxService,
    @Inject(forwardRef(() => BitgetService))
    private readonly bitgetService: BitgetService,
  ) {}

  @Get()
  get() {
    return this.settingsService.getMasked();
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto) {
    const settings = await this.settingsService.update(dto);
    const okxChanged = Boolean(
      dto.okxApiKey || dto.okxSecret || dto.okxPassphrase,
    );
    const bitgetChanged = Boolean(
      dto.bitgetApiKey || dto.bitgetSecret || dto.bitgetPassphrase,
    );
    if (okxChanged) await this.okxService.reconnect();
    if (bitgetChanged) await this.bitgetService.reconnect();
    return settings;
  }

  @Put('reconnect')
  async reconnect(@Query('exchange') exchange?: string) {
    const ex = parseExchange(exchange);
    if (!exchange) {
      await Promise.all([
        this.okxService.reconnect(),
        this.bitgetService.reconnect(),
      ]);
      return {
        okx: this.okxService.getStatus(),
        bitget: this.bitgetService.getStatus(),
      };
    }
    if (ex === 'bitget') {
      await this.bitgetService.reconnect();
      return this.bitgetService.getStatus();
    }
    await this.okxService.reconnect();
    return this.okxService.getStatus();
  }
}
