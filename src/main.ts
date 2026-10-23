import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { raw } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: false });

  // The profile-upload endpoint streams a tarball straight into req; keep
  // the raw body as a stream (don't parse as JSON) and raise the size cap
  // from Nest's 100 KB default to 200 MB so Zoom profiles fit.
  app.use('/admin/upload-profile', raw({ type: '*/*', limit: '200mb' }));

  // Make sure Puppeteer browsers and the Telegraf poller shut down cleanly
  // on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('HEALTH_PORT', 3000);

  await app.listen(port);
  logger.log(`Zoombot is up. Health endpoint on http://localhost:${port}/health`);
  logger.log('Telegram bot is polling for messages.');
}

void bootstrap();
