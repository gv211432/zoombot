import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ZoomModule } from '../zoom/zoom.module';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [AuthModule, ZoomModule],
  providers: [TelegramUpdate],
})
export class TelegramModule {}
