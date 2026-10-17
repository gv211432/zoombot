import { Module } from '@nestjs/common';
import { NameGeneratorService } from './name-generator.service';

@Module({
  providers: [NameGeneratorService],
  exports: [NameGeneratorService],
})
export class NameGeneratorModule {}
