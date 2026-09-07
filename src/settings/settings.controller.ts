import {
  Body,
  Controller,
  Get,
  Inject,
  Put,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
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
  ) {}

  @Get()
  get() {
    return this.settingsService.getMasked();
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto) {
    const settings = await this.settingsService.update(dto);
    await this.okxService.reconnect();
    return settings;
  }

  @Put('reconnect')
  async reconnect() {
    await this.okxService.reconnect();
    return this.okxService.getStatus();
  }
}
