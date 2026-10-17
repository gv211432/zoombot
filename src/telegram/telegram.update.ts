import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, Ctx, Help, On, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ZoomService } from '../zoom/zoom.service';
import { extractZoomUrl, parseZoomLink } from '../zoom/zoom-url.util';

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly allowedUserIds: Set<number>;

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
        '• Just paste a Zoom link to join it',
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

  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    if (!(await this.guard(ctx))) return;

    const text =
      ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (!text) return;

    const url = extractZoomUrl(text);
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

    if (this.zoom.isInMeeting(link.meetingNumber)) {
      await ctx.reply(`I'm already in meeting ${link.meetingNumber}.`);
      return;
    }

    await ctx.reply(`Joining meeting ${link.meetingNumber}…`);
    try {
      const names = await this.zoom.join(link);
      await ctx.reply(
        `✅ Joined meeting ${link.meetingNumber} as ${names.join(' and ')}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to join ${link.meetingNumber}: ${message}`);
      await ctx.reply(
        `❌ Couldn't join meeting ${link.meetingNumber}.\nReason: ${message}`,
      );
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
