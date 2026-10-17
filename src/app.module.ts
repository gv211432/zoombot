import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { HealthController } from './health.controller';
import { TelegramModule } from './telegram/telegram.module';
import { ZoomModule } from './zoom/zoom.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Telegram bot in long-polling mode — no public URL / webhook needed.
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
          throw new Error(
            'TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.',
          );
        }
        return { token };
      },
    }),

    ZoomModule,
    TelegramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
