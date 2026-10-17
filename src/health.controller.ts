import { Controller, Get } from '@nestjs/common';
import { ZoomService } from './zoom/zoom.service';

@Controller('health')
export class HealthController {
  constructor(private readonly zoom: ZoomService) {}

  @Get()
  health(): { status: string; activeMeetings: number } {
    return {
      status: 'ok',
      activeMeetings: this.zoom.activeCount(),
    };
  }
}
