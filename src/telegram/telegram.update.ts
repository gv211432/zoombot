import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { AuthService, LOCKOUT_MS, SESSION_IDLE_MS } from '../auth/auth.service';
import {
  JoinCancelledError,
  JoinDetails,
  JoinFailedError,
  JoinNeed,
  JoinNeedsInputError,
  JoinWait,
  MAX_BOTS_PER_MEETING,
  ZoomService,
} from '../zoom/zoom.service';
import {
  extractZoomUrl,
  ParsedZoomLink,
  parseZoomLink,
} from '../zoom/zoom-url.util';

/**
 * A join paused until the user replies: first with how many bots to send,
 * then with any detail Zoom asks for.
 */
type PendingJoin =
  | { need: 'count'; link: ParsedZoomLink; details: JoinDetails }
  | { need: JoinNeed; link: ParsedZoomLink; details: JoinDetails; botCount: number };

/** Quick picks offered as buttons; any other number in range can be typed. */
const BOT_COUNT_CHOICES = [1, 2, 3, 5, 10, 25, 50, 100, 250, 500];

const ASK_FOR: Record<JoinNeed, string> = {
  passcode: 'Reply with the meeting passcode',
  email: 'Reply with the email address the bots should use',
};

const WAIT_MESSAGES: Record<JoinWait, string> = {
  'waiting-room':
    '⏳ The bots are in the waiting room — admit them from the Participants list.',
  'waiting-for-host':
    "⏳ The meeting hasn't started yet. The bots will join once the host starts it.",
};

const LOGIN_PROMPT = 'Send /login <password> to start a session.';

const minutes = (ms: number) => Math.ceil(ms / 60_000);

const lockedMessage = (ms: number) =>
  `⛔ Too many wrong passwords. Try again in ${minutes(ms)} minute(s).`;

/** A whole number of bots in the allowed range, or undefined. */
function parseBotCount(value: string): number | undefined {
  const count = /^\d+$/.test(value) ? Number(value) : NaN;
  return count >= 1 && count <= MAX_BOTS_PER_MEETING ? count : undefined;
}

/** A button that makes the bots leave one meeting (or stop joining it). */
const leaveButton = (meetingNumber: string) =>
  Markup.button.callback(`🚪 Leave ${meetingNumber}`, `leave:${meetingNumber}`);

const leaveKeyboard = (meetingNumber: string) =>
  Markup.inlineKeyboard([leaveButton(meetingNumber)]);

/** Every name for a few bots; a sample for many, to fit a Telegram message. */
function botList(names: string[]): string {
  return names.length <= 5
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly allowedUserIds: Set<number>;
  /** Per chat: a join waiting on the user's reply. */
  private readonly pending = new Map<number, PendingJoin>();

  constructor(
    private readonly zoom: ZoomService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('TELEGRAM_ALLOWED_USER_IDS', '').trim();
    this.allowedUserIds = new Set(
      raw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    );
  }

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;
    await ctx.reply(
      [
        '👋 I am a Zoom notetaker bot.',
        '',
        `Send me a Zoom meeting link and say how many bots to send (1–${MAX_BOTS_PER_MEETING}).`,
        'Each joins under a random Indian name tagged "(bot)" so the room',
        'knows bots are present.',
        '',
        'Commands:',
        '• Just paste a Zoom link (or the whole invitation); I will ask how many bots',
        '• If the meeting needs a passcode, I will ask for it',
        '• /cancel — drop a join that is waiting for your reply',
        '• /status — which meetings I am in, with a 🚪 Leave button for each',
        '• /leave [meetingNumber] — leave one meeting, or all if omitted',
        '• 🚪 Leave buttons also appear on join messages, and stop a join in progress',
        '• /whoami — show your Telegram user id',
        `• /logout — end your session now (it also ends after ${minutes(SESSION_IDLE_MS)} idle minutes)`,
      ].join('\n'),
    );
  }

  @Help()
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await this.onStart(ctx);
  }

  @Command('whoami')
  async onWhoami(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(`Your Telegram user id is: ${ctx.from?.id ?? 'unknown'}`);
  }

  @Command('login')
  async onLogin(@Ctx() ctx: Context): Promise<void> {
    const userId = await this.allowedSender(ctx);
    if (userId === undefined) return;
    // Keep the password out of the chat history. Telegram only lets the bot
    // do this in private chats or groups where it is an admin.
    await ctx.deleteMessage().catch(() => undefined);

    const password = this.commandText(ctx);
    if (!password) {
      await ctx.reply('Usage: /login <password>');
      return;
    }
    if (this.auth.touchSession(userId) === 'active') {
      await ctx.reply('You are already logged in.');
      return;
    }

    const result = this.auth.login(userId, password);
    switch (result.status) {
      case 'ok':
        await ctx.reply(
          `✅ Logged in. Your session ends after ${minutes(SESSION_IDLE_MS)} minutes of inactivity.`,
        );
        return;
      case 'wrong-password':
        await ctx.reply(
          `❌ Wrong password. ${result.attemptsLeft} attempt(s) left before a ${minutes(LOCKOUT_MS)}-minute lockout.`,
        );
        return;
      case 'locked':
        await ctx.reply(lockedMessage(result.retryInMs));
        return;
    }
  }

  @Command('logout')
  async onLogout(@Ctx() ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const ended = userId !== undefined && this.auth.logout(userId);
    await ctx.reply(ended ? '👋 Logged out.' : 'You are not logged in.');
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;
    const active = this.zoom.activeMeetingNumbers();
    if (active.length === 0) {
      await ctx.reply('Not in any meetings right now.');
      return;
    }
    const describe = (n: string) => {
      const names = this.zoom.displayNamesIn(n);
      return this.zoom.isJoining(n)
        ? `• ${n}: joining, ${names.length} in so far`
        : `• ${n}: ${botList(names)}`;
    };
    const buttons = active.map((n) => [leaveButton(n)]);
    if (active.length > 1) {
      buttons.push([Markup.button.callback('🚪 Leave all', 'leave:all')]);
    }
    await ctx.reply(
      [`Currently in ${active.length} meeting(s):`, ...active.map(describe)].join('\n'),
      Markup.inlineKeyboard(buttons),
    );
  }

  @Command('leave')
  async onLeave(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;
    const arg = this.commandArg(ctx);
    if (arg) {
      const left = await this.zoom.leave(arg);
      await ctx.reply(left ? `Left meeting ${arg}.` : `I am not in meeting ${arg}.`);
      return;
    }
    const count = await this.zoom.leaveAll();
    await ctx.reply(count > 0 ? `Left ${count} meeting(s).` : 'No meetings to leave.');
  }

  @Command('cancel')
  async onCancel(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;
    const cancelled = ctx.chat !== undefined && this.pending.delete(ctx.chat.id);
    await ctx.reply(cancelled ? 'OK, cancelled that join.' : 'Nothing to cancel.');
  }

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;

    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    const chatId = ctx.chat?.id;
    if (!text || chatId === undefined) return;

    const url = extractZoomUrl(text);
    const pending = this.pending.get(chatId);
    if (!url && pending) {
      // The answer to what we asked: start or retry the join with it.
      const value = text.trim();
      if (pending.need === 'count') {
        const botCount = parseBotCount(value);
        if (botCount === undefined) {
          await ctx.reply(
            `Send a whole number from 1 to ${MAX_BOTS_PER_MEETING}, or /cancel.`,
          );
          return;
        }
        this.pending.delete(chatId);
        void this.runJoin(ctx, pending.link, pending.details, botCount);
        return;
      }
      if (pending.need === 'email' && !/^\S+@\S+\.\S+$/.test(value)) {
        await ctx.reply("That doesn't look like an email address. Try again, or /cancel.");
        return;
      }
      this.pending.delete(chatId);
      void this.runJoin(
        ctx,
        pending.link,
        { ...pending.details, [pending.need]: value },
        pending.botCount,
      );
      return;
    }

    if (!url) {
      await ctx.reply(
        "That doesn't look like a Zoom link. Paste a link like https://…zoom.us/j/1234567890?pwd=…",
      );
      return;
    }

    const link = parseZoomLink(url);
    if (!link) {
      await ctx.reply(
        'I found a Zoom URL but could not read a meeting number from it. ' +
          'Personal-link (…/my/alias) and registration URLs are not supported — ' +
          'send the numeric /j/ link instead.',
      );
      return;
    }

    this.pending.delete(chatId); // a new link replaces any unanswered question
    if (this.zoom.isInMeeting(link.meetingNumber)) {
      await ctx.reply(
        `I'm already in (or joining) meeting ${link.meetingNumber}.`,
        leaveKeyboard(link.meetingNumber),
      );
      return;
    }

    // A pasted Zoom invitation often includes "Passcode: abc123" as text.
    const passcode = text.match(/\bpasscode\s*:\s*(\S+)/i)?.[1];
    this.pending.set(chatId, { need: 'count', link, details: { passcode } });
    await ctx.reply(
      `How many bots should join meeting ${link.meetingNumber}? ` +
        `Tap one, or type any number from 1 to ${MAX_BOTS_PER_MEETING}.`,
      Markup.inlineKeyboard(
        BOT_COUNT_CHOICES.map((n) =>
          Markup.button.callback(String(n), `bots:${link.meetingNumber}:${n}`),
        ),
        { columns: 5 },
      ),
    );
  }

  /** A tap on one of the "how many bots" buttons. */
  @Action(/^bots:/)
  async onBotCountChosen(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery().catch(() => undefined); // stop the button's spinner
    if (!(await this.guard(ctx))) return;

    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const [, meetingNumber, count] = data.split(':');
    const chatId = ctx.chat?.id;
    const pending = chatId === undefined ? undefined : this.pending.get(chatId);
    const botCount = parseBotCount(count ?? '');
    if (
      chatId === undefined ||
      pending?.need !== 'count' ||
      pending.link.meetingNumber !== meetingNumber ||
      botCount === undefined
    ) {
      await ctx.reply('That question has expired. Send the Zoom link again.');
      return;
    }

    this.pending.delete(chatId);
    // Drop the buttons so the same question can't start a second join.
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    void this.runJoin(ctx, pending.link, pending.details, botCount);
  }

  /**
   * Join and report back in the chat. Callers don't await this: waiting to be
   * admitted can take minutes, longer than Telegraf's 90s handler timeout.
   */
  private async runJoin(
    ctx: Context,
    link: ParsedZoomLink,
    details: JoinDetails,
    botCount: number,
  ): Promise<void> {
    const meeting = link.meetingNumber;
    const warn = (e: unknown) =>
      this.logger.warn(`Could not send Telegram reply: ${e}`);
    const say = (message: string, withLeaveButton = false) =>
      ctx
        .reply(message, withLeaveButton ? leaveKeyboard(meeting) : undefined)
        .catch(warn);
    // On Railway the screenshot on disk is out of reach, so send it here.
    const showScreenshot = (image: Buffer | undefined) =>
      image &&
      ctx
        .replyWithPhoto({ source: image }, { caption: 'What Zoom showed the bot' })
        .catch(warn);

    await say(`Joining meeting ${meeting} with ${botCount} bot(s)…`, true);
    try {
      const { joined, failed, failureReason, failureScreenshot } =
        await this.zoom.join(link, details, botCount, {
          onWait: (state) => void say(WAIT_MESSAGES[state]),
          onEnded: (reason) =>
            void say(`👋 The bots left meeting ${meeting}: ${reason}.`),
        });
      await say(
        failed === 0
          ? `✅ Joined meeting ${meeting} with ${joined.length} bot(s): ${botList(joined)}.`
          : `⚠️ Only ${joined.length} of ${botCount} bots got into meeting ${meeting}: ` +
              `${botList(joined)}.\nThe other ${failed} didn't: ${failureReason}`,
        true,
      );
      await showScreenshot(failureScreenshot);
    } catch (err) {
      if (err instanceof JoinCancelledError) {
        return; // the Leave handler already replied
      }
      if (err instanceof JoinNeedsInputError && ctx.chat) {
        this.pending.set(ctx.chat.id, { need: err.need, link, details, botCount });
        await say(`🔒 ${err.message} ${ASK_FOR[err.need]}, or /cancel.`);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to join ${meeting}: ${message}`);
      await say(`❌ Couldn't join meeting ${meeting}.\nReason: ${message}`);
      if (err instanceof JoinFailedError) {
        await showScreenshot(err.screenshot);
      }
    }
  }

  /** A tap on a "Leave" button: the bots leave that meeting (or all of them). */
  @Action(/^leave:/)
  async onLeaveTapped(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery().catch(() => undefined); // stop the button's spinner
    if (!(await this.guard(ctx))) return;

    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const target = data.slice('leave:'.length);
    if (target === 'all') {
      const count = await this.zoom.leaveAll();
      await ctx.reply(count > 0 ? `👋 Left ${count} meeting(s).` : 'No meetings to leave.');
      return;
    }
    const left = await this.zoom.leave(target);
    await ctx.reply(
      left ? `👋 The bots left meeting ${target}.` : `I am not in meeting ${target}.`,
    );
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the sender is permitted and logged in, keeping their
   * session alive; replies and returns false if not.
   */
  private async guard(ctx: Context): Promise<boolean> {
    const userId = await this.allowedSender(ctx);
    if (userId === undefined) return false;

    switch (this.auth.touchSession(userId)) {
      case 'active':
        return true;
      case 'expired':
        await ctx.reply(
          `🔒 Your session ended after ${minutes(SESSION_IDLE_MS)} minutes of inactivity. ${LOGIN_PROMPT}`,
        );
        return false;
      case 'none': {
        const lockedFor = this.auth.lockedFor(userId);
        await ctx.reply(lockedFor > 0 ? lockedMessage(lockedFor) : `🔒 ${LOGIN_PROMPT}`);
        return false;
      }
    }
  }

  /**
   * The sender's user id if the allow-list permits them (anyone, when it is
   * empty); replies and returns undefined if not.
   */
  private async allowedSender(ctx: Context): Promise<number | undefined> {
    const id = ctx.from?.id;
    if (
      id !== undefined &&
      (this.allowedUserIds.size === 0 || this.allowedUserIds.has(id))
    ) {
      return id;
    }
    await ctx.reply('⛔ You are not authorised to use this bot.');
    return undefined;
  }

  /** Everything after the command, e.g. "my pass" in "/login my pass". */
  private commandText(ctx: Context): string {
    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    return text.replace(/^\/\S+\s*/, '').trim();
  }

  private commandArg(ctx: Context): string | undefined {
    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.trim().split(/\s+/);
    return parts.length > 1 ? parts[1] : undefined;
  }
}
