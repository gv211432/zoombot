import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { HealthController } from './health.controller';
import { NameGeneratorModule } from './name-generator/name-generator.module';
import { TelegramModule } from './telegram/telegram.module';
import { ZoomModule } from './zoom/zoom.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Telegram bot in long-polling mode — no public URL / webhook needed.
    // TelegramPolling starts the polling, so it can survive a 409 on redeploy.
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
        return { token, launchOptions: false };
      },
    }),

    ZoomModule,
    TelegramModule,
    NameGeneratorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
