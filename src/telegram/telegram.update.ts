import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import {
  JoinDetails,
  JoinNeed,
  JoinNeedsInputError,
  JoinWait,
  ZoomService,
} from '../zoom/zoom.service';
import {
  extractZoomUrl,
  ParsedZoomLink,
  parseZoomLink,
} from '../zoom/zoom-url.util';

/** A join paused until the user replies with the detail Zoom asked for. */
interface PendingJoin {
  link: ParsedZoomLink;
  details: JoinDetails;
  need: JoinNeed;
}

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

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly allowedUserIds: Set<number>;
  /** Per chat: a join waiting on the user's reply. */
  private readonly pending = new Map<number, PendingJoin>();

  constructor(
    private readonly zoom: ZoomService,
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
        'Send me a Zoom meeting link and I will join it with two bot',
        'participants, each under a random Indian name tagged "(bot)" so the',
        'room knows bots are present.',
        '',
        'Commands:',
        '• Just paste a Zoom link (or the whole invitation) to join it',
        '• If the meeting needs a passcode, I will ask for it',
        '• /cancel — drop a join that is waiting for your reply',
        '• /status — which meetings I am currently in',
        '• /leave [meetingNumber] — leave one meeting, or all if omitted',
        '• /whoami — show your Telegram user id',
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

  @Command('status')
  async onStatus(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;
    const active = this.zoom.activeMeetingNumbers();
    if (active.length === 0) {
      await ctx.reply('Not in any meetings right now.');
      return;
    }
    await ctx.reply(
      [
        `Currently in ${active.length} meeting(s):`,
        ...active.map(
          (n) => `• ${n}: ${this.zoom.displayNamesIn(n).join(', ')}`,
        ),
      ].join('\n'),
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
      // The answer to the detail we asked for: retry the join with it.
      const value = text.trim();
      if (pending.need === 'email' && !/^\S+@\S+\.\S+$/.test(value)) {
        await ctx.reply("That doesn't look like an email address. Try again, or /cancel.");
        return;
      }
      this.pending.delete(chatId);
      void this.runJoin(ctx, pending.link, {
        ...pending.details,
        [pending.need]: value,
      });
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
      await ctx.reply(`I'm already in meeting ${link.meetingNumber}.`);
      return;
    }

    // A pasted Zoom invitation often includes "Passcode: abc123" as text.
    const passcode = text.match(/\bpasscode\s*:\s*(\S+)/i)?.[1];
    void this.runJoin(ctx, link, { passcode });
  }

  /**
   * Join and report back in the chat. Callers don't await this: waiting to be
   * admitted can take minutes, longer than Telegraf's 90s handler timeout.
   */
  private async runJoin(
    ctx: Context,
    link: ParsedZoomLink,
    details: JoinDetails,
  ): Promise<void> {
    const meeting = link.meetingNumber;
    const say = (message: string) =>
      ctx
        .reply(message)
        .catch((e) => this.logger.warn(`Could not send Telegram reply: ${e}`));

    await say(`Joining meeting ${meeting}…`);
    try {
      const names = await this.zoom.join(link, details, (state) => {
        void say(WAIT_MESSAGES[state]);
      });
      await say(`✅ Joined meeting ${meeting} as ${names.join(' and ')}.`);
    } catch (err) {
      if (err instanceof JoinNeedsInputError && ctx.chat) {
        this.pending.set(ctx.chat.id, { link, details, need: err.need });
        await say(`🔒 ${err.message} ${ASK_FOR[err.need]}, or /cancel.`);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to join ${meeting}: ${message}`);
      await say(`❌ Couldn't join meeting ${meeting}.\nReason: ${message}`);
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /** Returns true if the sender is permitted; replies and returns false if not. */
  private async guard(ctx: Context): Promise<boolean> {
    if (this.allowedUserIds.size === 0) {
      return true; // open to anyone who can message the bot
    }
    const id = ctx.from?.id;
    if (id && this.allowedUserIds.has(id)) {
      return true;
    }
    await ctx.reply('⛔ You are not authorised to use this bot.');
    return false;
  }

  private commandArg(ctx: Context): string | undefined {
    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.trim().split(/\s+/);
    return parts.length > 1 ? parts[1] : undefined;
  }
}
