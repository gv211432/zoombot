import { Module } from '@nestjs/common';
import { ZoomModule } from '../zoom/zoom.module';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [ZoomModule],
  providers: [TelegramUpdate],
})
export class TelegramModule {}
