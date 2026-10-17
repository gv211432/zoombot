import { Module } from '@nestjs/common';
import { NameGeneratorModule } from '../name-generator/name-generator.module';
import { ZoomService } from './zoom.service';

@Module({
  imports: [NameGeneratorModule],
  providers: [ZoomService],
  exports: [ZoomService],
})
export class ZoomModule {}
