import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ZoomModule } from '../zoom/zoom.module';
import { TelegramPolling } from './telegram-polling.service';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [AuthModule, ZoomModule],
  providers: [TelegramPolling, TelegramUpdate],
})
export class TelegramModule {}
