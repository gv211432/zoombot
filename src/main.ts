import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

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
