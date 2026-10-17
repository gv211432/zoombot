import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf, TelegramError } from 'telegraf';

/** How long to wait before polling again after Telegram reports another poller. */
const CONFLICT_RETRY_MS = 10_000;

/**
 * Runs Telegram long polling. Telegram allows one poller per bot token, so
 * while a redeploy briefly overlaps the old and new containers one of them
 * gets a 409. Telegraf treats that as fatal and the process would crash,
 * killing any join in progress; this waits and polls again instead.
 */
@Injectable()
export class TelegramPolling
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramPolling.name);
  private stopping = false;

  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {}

  onApplicationBootstrap(): void {
    this.poll().catch((err) => {
      this.logger.error(`Telegram polling failed: ${err}`);
      process.exit(1);
    });
  }

  onApplicationShutdown(): void {
    this.stopping = true; // nestjs-telegraf stops the bot itself
  }

  private async poll(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.bot.launch(); // resolves only once polling stops
        return;
      } catch (err) {
        if (!(err instanceof TelegramError && err.code === 409)) {
          throw err;
        }
        this.logger.warn(
          'Another process is polling with this bot token (usually the previous ' +
            `deploy shutting down). Retrying in ${CONFLICT_RETRY_MS / 1000}s.`,
        );
        await new Promise((resolve) => setTimeout(resolve, CONFLICT_RETRY_MS));
      }
    }
  }
}
