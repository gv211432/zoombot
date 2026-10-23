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

/** How long to wait before retrying after a transient network error. */
const NETWORK_RETRY_MS = 5_000;

/**
 * Runs Telegram long polling. Telegram allows one poller per bot token, so
 * while a redeploy briefly overlaps the old and new containers one of them
 * gets a 409. Telegraf treats that as fatal and the process would crash,
 * killing any join in progress; this waits and polls again instead.
 *
 * Also retries on transient network errors (FetchError, ECONNRESET, ETIMEDOUT)
 * which can occur when Docker's bridge network drops the connection briefly.
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
      this.logger.error(`Telegram polling failed fatally: ${err}`);
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
        if (this.stopping) return;

        // 409: another process is holding the polling slot (e.g. previous deploy).
        if (err instanceof TelegramError && err.code === 409) {
          this.logger.warn(
            'Another process is polling with this bot token (usually the previous ' +
              `deploy shutting down). Retrying in ${CONFLICT_RETRY_MS / 1000}s.`,
          );
          await this.sleep(CONFLICT_RETRY_MS);
          continue;
        }

        // Transient network errors (Docker bridge DNS hiccup, timeout, reset).
        // Retrying is safe — Telegraf will re-call getMe then resume polling.
        if (this.isNetworkError(err)) {
          this.logger.warn(
            `Telegram polling hit a network error (${this.errorMessage(err)}). ` +
              `Retrying in ${NETWORK_RETRY_MS / 1000}s.`,
          );
          await this.sleep(NETWORK_RETRY_MS);
          continue;
        }

        // Any other error (bad token, etc.) is genuinely fatal.
        throw err;
      }
    }
  }

  /** True for transient network failures that are safe to retry. */
  private isNetworkError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      err.constructor.name === 'FetchError' ||
      /network timeout|econnreset|econnrefused|etimedout|socket hang up|fetch failed/i.test(msg)
    );
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

