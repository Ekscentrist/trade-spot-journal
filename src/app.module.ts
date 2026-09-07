import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { DealsModule } from './deals/deals.module.js';
import { OkxModule } from './okx/okx.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    SettingsModule,
    OrdersModule,
    DealsModule,
    TelegramModule,
    OkxModule,
  ],
})
export class AppModule {}
