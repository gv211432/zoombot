import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

/** A session ends after this long without a message from its user. */
export const SESSION_IDLE_MS = 10 * 60 * 1000;
/** Wrong passwords a user may send before being locked out. */
export const MAX_LOGIN_ATTEMPTS = 3;
/** How long a locked-out user must wait before trying again. */
export const LOCKOUT_MS = 10 * 60 * 1000;

export type SessionState = 'active' | 'expired' | 'none';

export type LoginResult =
  | { status: 'ok' }
  | { status: 'wrong-password'; attemptsLeft: number }
  | { status: 'locked'; retryInMs: number };

interface FailedLogins {
  count: number;
  lockedUntil?: number;
}

/**
 * Password sessions per Telegram user, kept in memory: a restart logs
 * everyone out and clears lockouts.
 */
@Injectable()
export class AuthService {
  private readonly passwordDigest: Buffer;
  /** Per user with an open session: when they last used it. */
  private readonly lastActivity = new Map<number, number>();
  private readonly failures = new Map<number, FailedLogins>();

  constructor(config: ConfigService) {
    const password = config.get<string>('BOT_PASSWORD', '');
    if (!password) {
      throw new Error(
        'BOT_PASSWORD is not set. Add it to .env — users send it with /login to use the bot.',
      );
    }
    this.passwordDigest = digest(password);
  }

  /**
   * Reports the user's session state. An active session counts this call as
   * activity, so it stays open for another SESSION_IDLE_MS.
   */
  touchSession(userId: number): SessionState {
    const last = this.lastActivity.get(userId);
    if (last === undefined) return 'none';
    const now = Date.now();
    if (now - last > SESSION_IDLE_MS) {
      this.lastActivity.delete(userId);
      return 'expired';
    }
    this.lastActivity.set(userId, now);
    return 'active';
  }

  /** Milliseconds until the user may try a password again; 0 if not locked. */
  lockedFor(userId: number): number {
    const lockedUntil = this.failures.get(userId)?.lockedUntil;
    if (lockedUntil === undefined) return 0;
    const remaining = lockedUntil - Date.now();
    if (remaining <= 0) {
      this.failures.delete(userId); // lockout served: a fresh set of attempts
      return 0;
    }
    return remaining;
  }

  login(userId: number, password: string): LoginResult {
    const retryInMs = this.lockedFor(userId);
    if (retryInMs > 0) return { status: 'locked', retryInMs };

    // Comparing fixed-length digests keeps the check constant-time.
    if (timingSafeEqual(digest(password), this.passwordDigest)) {
      this.failures.delete(userId);
      this.lastActivity.set(userId, Date.now());
      return { status: 'ok' };
    }

    const count = (this.failures.get(userId)?.count ?? 0) + 1;
    if (count >= MAX_LOGIN_ATTEMPTS) {
      this.failures.set(userId, { count, lockedUntil: Date.now() + LOCKOUT_MS });
      return { status: 'locked', retryInMs: LOCKOUT_MS };
    }
    this.failures.set(userId, { count });
    return { status: 'wrong-password', attemptsLeft: MAX_LOGIN_ATTEMPTS - count };
  }

  /** Ends the user's session. Returns false if they had none. */
  logout(userId: number): boolean {
    return this.lastActivity.delete(userId);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
