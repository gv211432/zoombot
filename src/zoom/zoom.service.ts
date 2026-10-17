import { promises as fs } from 'node:fs';
import { join as pathJoin } from 'node:path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, { Browser, Page } from 'puppeteer';
import { NameGeneratorService } from '../name-generator/name-generator.service';
import { ParsedZoomLink } from './zoom-url.util';

/** The most bot participants one join may ask for. */
export const MAX_BOTS_PER_MEETING = 500;

/** Bots that fail one after another before we stop starting new ones. */
const MAX_FAILURES_IN_A_ROW = 3;

/** Appended to every generated name so the room can tell the bots from people. */
const BOT_NAME_TAG = ' (bot)';

/** Details only some meetings ask for; the user supplies them on request. */
export interface JoinDetails {
  passcode?: string;
  email?: string;
}

export type JoinNeed = keyof JoinDetails;

/** Zoom asked for a detail we don't have: ask the user, then join again. */
export class JoinNeedsInputError extends Error {
  constructor(
    readonly need: JoinNeed,
    message: string,
  ) {
    super(message);
  }
}

/** The meeting won't admit any bot (ended, invalid, signed-in users only). */
class MeetingClosedError extends Error {}

/** The meeting is at its participant limit, so no further bot will get in. */
class MeetingFullError extends Error {}

/** Places a bot can sit after clicking Join that the user should hear about. */
export type JoinWait = 'waiting-room' | 'waiting-for-host';

export interface JoinResult {
  /** Display names of the bots now in the meeting. */
  joined: string[];
  /** Bots that didn't get in: they failed, or never started once joining stopped. */
  failed: number;
  /** Why the first of them failed. */
  failureReason?: string;
}

type JoinState =
  | JoinWait
  | 'in-meeting'
  | 'wrong-passcode'
  | 'sign-in-required'
  | 'unavailable'
  | 'full'
  | 'pending';

interface MeetingSession {
  browser: Browser;
  displayNames: string[];
  link: ParsedZoomLink;
  joinedAt: Date;
}

@Injectable()
export class ZoomService implements OnModuleDestroy {
  private readonly logger = new Logger(ZoomService.name);
  private readonly sessions = new Map<string, MeetingSession>();
  /** Meetings with a join in progress, which can take minutes in a waiting room. */
  private readonly joining = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly names: NameGeneratorService,
  ) {}

  activeCount(): number {
    return this.sessions.size;
  }

  activeMeetingNumbers(): string[] {
    return [...this.sessions.keys()];
  }

  isInMeeting(meetingNumber: string): boolean {
    return this.sessions.has(meetingNumber);
  }

  /** The display names the bots in a meeting joined as. */
  displayNamesIn(meetingNumber: string): string[] {
    return this.sessions.get(meetingNumber)?.displayNames ?? [];
  }

  /**
   * Open the Zoom web client in a headless browser and join the meeting with
   * `botCount` participants (muted, no video), each in its own browser context
   * under a distinct random Indian name tagged as a bot. Resolves once every
   * bot is in the meeting or has given up.
   *
   * Problems with the meeting itself (needs a passcode, ended, signed-in users
   * only) stop the whole join. A single bot failing only drops that bot; a
   * full meeting, or MAX_FAILURES_IN_A_ROW failures, stops new bots starting.
   *
   * @param details passcode/email, for meetings whose join page asks for them
   * @param onWait called once per waiting state (e.g. the waiting room)
   * @throws JoinNeedsInputError when Zoom asks for a detail not in `details`
   */
  async join(
    link: ParsedZoomLink,
    details: JoinDetails,
    botCount: number,
    onWait?: (state: JoinWait) => void,
  ): Promise<JoinResult> {
    const { meetingNumber } = link;
    if (
      !Number.isInteger(botCount) ||
      botCount < 1 ||
      botCount > MAX_BOTS_PER_MEETING
    ) {
      throw new RangeError(
        `The number of bots must be from 1 to ${MAX_BOTS_PER_MEETING}; got ${botCount}.`,
      );
    }
    if (this.sessions.has(meetingNumber) || this.joining.has(meetingNumber)) {
      throw new Error(`Already in or joining meeting ${meetingNumber}.`);
    }
    this.joining.add(meetingNumber);
    try {
      return await this.joinAll(link, details, botCount, onWait);
    } finally {
      this.joining.delete(meetingNumber);
    }
  }

  private async joinAll(
    link: ParsedZoomLink,
    details: JoinDetails,
    botCount: number,
    onWait?: (state: JoinWait) => void,
  ): Promise<JoinResult> {
    const displayNames = this.pickDisplayNames(botCount);
    const browser = await this.launchBrowser();
    // Loading the join page is the heavy part, so only a few bots do it at
    // once; each frees its slot as soon as it has clicked Join.
    const slots = new Slots(this.joinConcurrency());

    // The bots land in the same waiting room; tell the user once.
    const announced = new Set<JoinWait>();
    const announce = (state: JoinWait) => {
      if (!announced.has(state)) {
        announced.add(state);
        onWait?.(state);
      }
    };

    const joined: string[] = [];
    let firstError: unknown;
    let fatal = false; // the meeting won't take any bot: everyone leaves
    let stopped = false; // no point starting more bots
    let failuresInARow = 0;

    await Promise.all(
      displayNames.map(async (name, i) => {
        const release = await slots.acquire();
        try {
          if (stopped) {
            return;
          }
          await this.joinAs(browser, link, details, name, i + 1, announce, () => {
            failuresInARow = 0;
            release();
          });
          joined.push(name);
        } catch (err) {
          if (fatal) {
            return; // the browser was closed under this bot
          }
          firstError ??= err;
          if (err instanceof JoinNeedsInputError || err instanceof MeetingClosedError) {
            // Close the browser so the other bots stop too, rather than
            // sitting in a waiting room for minutes.
            fatal = stopped = true;
            firstError = err;
            await browser.close().catch(() => undefined);
          } else if (
            err instanceof MeetingFullError ||
            ++failuresInARow >= MAX_FAILURES_IN_A_ROW
          ) {
            stopped = true;
          }
        } finally {
          release();
        }
      }),
    );

    if (fatal || joined.length === 0) {
      await browser.close().catch(() => undefined);
      throw firstError;
    }

    this.sessions.set(link.meetingNumber, {
      browser,
      displayNames: joined,
      link,
      joinedAt: new Date(),
    });
    this.logger.log(
      `Joined meeting ${link.meetingNumber} with ${joined.length} of ${botCount} bots.`,
    );
    const failed = botCount - joined.length;
    return {
      joined,
      failed,
      failureReason:
        failed > 0
          ? firstError instanceof Error
            ? firstError.message
            : String(firstError)
          : undefined,
    };
  }

  /**
   * Join one bot in its own browser context, so Zoom sees a separate client.
   * Calls `joinClicked` once it has clicked Join; on failure the bot's context
   * is closed, leaving the other bots in place.
   */
  private async joinAs(
    browser: Browser,
    link: ParsedZoomLink,
    details: JoinDetails,
    displayName: string,
    botNumber: number,
    onWait: (state: JoinWait) => void,
    joinClicked: () => void,
  ): Promise<void> {
    const stepTimeout = Number(
      this.config.get<string>('ZOOM_STEP_TIMEOUT_MS', '45000'),
    );

    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );

      this.logger.log(
        `Opening web client for meeting ${link.meetingNumber} as "${displayName}"`,
      );
      await page.goto(link.webClientUrl, {
        waitUntil: 'networkidle2',
        timeout: stepTimeout,
      });

      await this.dismissCookieBanner(page);

      const nameOk = await this.typeIntoFirst(
        page,
        this.nameSelectors(),
        displayName,
        stepTimeout,
      );
      if (!nameOk) {
        this.failIfBlocked(await this.readJoinState(page));
        throw new Error('Could not find the display-name input on the join page.');
      }

      // Shown only when the link doesn't carry the passcode (no ?pwd=), and on
      // webinars that collect an email.
      await this.fillIfShown(
        page,
        this.passcodeSelectors(),
        details.passcode,
        'passcode',
        'This meeting needs a passcode.',
      );
      await this.fillIfShown(
        page,
        this.emailSelectors(),
        details.email,
        'email',
        'This meeting asks for an email address (usually a webinar).',
      );

      const joinOk = await this.clickJoin(page);
      if (!joinOk) {
        throw new Error('Could not find or click the Join button.');
      }
      joinClicked();

      await this.waitUntilAdmitted(page, onWait);
      await this.handlePostJoin(page);
    } catch (err) {
      // Problems with the meeting aren't page problems, and once the browser
      // is closed (the whole join stopped) there's no page to screenshot.
      if (
        err instanceof JoinNeedsInputError ||
        err instanceof MeetingClosedError ||
        !browser.connected
      ) {
        throw err;
      }
      if (!(err instanceof MeetingFullError)) {
        await this.captureDebugScreenshot(
          page,
          `${link.meetingNumber}-bot${botNumber}`,
        );
      }
      await context.close().catch(() => undefined);
      if (err instanceof MeetingFullError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Bot ${botNumber} ("${displayName}"): ${message}`);
    }
  }

  /** Distinct random Indian names, each tagged so participants know it's a bot. */
  private pickDisplayNames(count: number): string[] {
    const names = new Set<string>();
    while (names.size < count) {
      names.add(this.names.random().fullName + BOT_NAME_TAG);
    }
    return [...names];
  }

  /** Leave a specific meeting (closes its browser). */
  async leave(meetingNumber: string): Promise<boolean> {
    const session = this.sessions.get(meetingNumber);
    if (!session) {
      return false;
    }
    this.sessions.delete(meetingNumber);
    await session.browser.close().catch((e) =>
      this.logger.warn(`Error closing browser for ${meetingNumber}: ${e}`),
    );
    this.logger.log(`Left meeting ${meetingNumber}.`);
    return true;
  }

  /** Leave every active meeting. */
  async leaveAll(): Promise<number> {
    const numbers = this.activeMeetingNumbers();
    for (const n of numbers) {
      await this.leave(n);
    }
    return numbers.length;
  }

  async onModuleDestroy(): Promise<void> {
    await this.leaveAll();
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async launchBrowser(): Promise<Browser> {
    const headless =
      this.config.get<string>('PUPPETEER_HEADLESS', 'true') !== 'false';
    return puppeteer.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Supply fake audio/video so Zoom's getUserMedia resolves instead of
        // hanging on a non-existent camera/mic, and so no permission prompt
        // blocks the flow. This is about not stalling in a headless container,
        // not about hiding what the bot is.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1280,800',
      ],
    });
  }

  private nameSelectors(): string[] {
    return this.selectorsFromEnv('ZOOM_SEL_NAME_INPUT', [
      '#input-for-name',
      '#inputname',
      'input[aria-label="Your Name"]',
      'input[placeholder*="name" i]',
    ]);
  }

  private passcodeSelectors(): string[] {
    return this.selectorsFromEnv('ZOOM_SEL_PASSCODE_INPUT', [
      '#input-for-pwd',
      '#inputpasscode',
      'input[aria-label*="passcode" i]',
      'input[type="password"]',
    ]);
  }

  private emailSelectors(): string[] {
    return this.selectorsFromEnv('ZOOM_SEL_EMAIL_INPUT', [
      '#input-for-email',
      'input[type="email"]',
      'input[aria-label*="email" i]',
      'input[placeholder*="email" i]',
    ]);
  }

  private joinSelectors(): string[] {
    return this.selectorsFromEnv('ZOOM_SEL_JOIN_BUTTON', [
      'button.preview-join-button',
      '#joinBtn',
      'button[type="submit"]',
    ]);
  }

  private selectorsFromEnv(key: string, defaults: string[]): string[] {
    const override = this.config.get<string>(key, '').trim();
    if (!override) {
      return defaults;
    }
    return override
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private async typeIntoFirst(
    page: Page,
    selectors: string[],
    value: string,
    firstTimeout: number,
  ): Promise<boolean> {
    for (let i = 0; i < selectors.length; i++) {
      const selector = selectors[i];
      try {
        // Give the first (most-likely) selector the full budget — the page may
        // still be rendering. Fallbacks get a short probe each.
        const timeout = i === 0 ? firstTimeout : 3000;
        const el = await page.waitForSelector(selector, {
          visible: true,
          timeout,
        });
        if (el) {
          await el.click({ clickCount: 3 }); // select any prefilled text
          await el.type(value, { delay: 20 });
          return true;
        }
      } catch {
        // try next selector
      }
    }
    return false;
  }

  /**
   * Fill a field the join page shows only for some meetings. If it's showing
   * and we don't have the value, stop so the user can be asked for it.
   */
  private async fillIfShown(
    page: Page,
    selectors: string[],
    value: string | undefined,
    need: JoinNeed,
    missingMessage: string,
  ): Promise<void> {
    for (const selector of selectors) {
      const field = await page.$(selector);
      if (field && (await field.isVisible())) {
        if (!value) {
          throw new JoinNeedsInputError(need, missingMessage);
        }
        await field.click({ clickCount: 3 });
        await field.type(value, { delay: 20 });
        return;
      }
    }
  }

  /**
   * After clicking Join, wait until the bot is really in the meeting,
   * reporting waiting rooms on the way and failing fast on dead ends.
   */
  private async waitUntilAdmitted(
    page: Page,
    onWait: (state: JoinWait) => void,
  ): Promise<void> {
    const timeout = Number(
      this.config.get<string>('ZOOM_ADMIT_TIMEOUT_MS', '300000'),
    );
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await this.readJoinState(page);
      if (state === 'in-meeting') {
        return;
      }
      if (state === 'wrong-passcode') {
        throw new JoinNeedsInputError('passcode', 'Zoom rejected that passcode.');
      }
      this.failIfBlocked(state);
      if (state === 'waiting-room' || state === 'waiting-for-host') {
        onWait(state);
      }
      await this.sleep(1000);
    }
    throw new Error(
      `Still not in the meeting after ${Math.round(timeout / 1000)}s ` +
        '(was it admitted from the waiting room?).',
    );
  }

  /**
   * Classify what the web client shows. "In the meeting" is the Leave button
   * in the meeting controls; the rest comes from Zoom's on-screen messages.
   */
  private async readJoinState(page: Page): Promise<JoinState> {
    try {
      return await page.evaluate((): JoinState => {
        const inMeeting = Array.from(document.querySelectorAll('button')).some(
          (b) =>
            (b.offsetWidth > 0 || b.offsetHeight > 0) &&
            /^leave$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()),
        );
        if (inMeeting) {
          return 'in-meeting';
        }
        const text = document.body.innerText;
        if (/incorrect (password|passcode)|(password|passcode) (is )?(wrong|incorrect)/i.test(text)) {
          return 'wrong-passcode';
        }
        if (/sign in to join|authorized attendees only|only authenticated users/i.test(text)) {
          return 'sign-in-required';
        }
        if (/meeting has (been )?ended|invalid meeting|meeting id is not valid|not a valid meeting|removed you from/i.test(text)) {
          return 'unavailable';
        }
        if (/meeting is full|reached (its|the) (maximum|participant limit|capacity)|maximum number of participants/i.test(text)) {
          return 'full';
        }
        if (/host will let you in|waiting room/i.test(text)) {
          return 'waiting-room';
        }
        if (/waiting for (the )?host to start/i.test(text)) {
          return 'waiting-for-host';
        }
        return 'pending';
      });
    } catch {
      return 'pending'; // the page was mid-navigation
    }
  }

  private failIfBlocked(state: JoinState): void {
    if (state === 'sign-in-required') {
      throw new MeetingClosedError(
        "This meeting only admits signed-in Zoom users, so the bots can't join it as guests.",
      );
    }
    if (state === 'unavailable') {
      throw new MeetingClosedError(
        'Zoom says this meeting has ended or the link is invalid.',
      );
    }
    if (state === 'full') {
      throw new MeetingFullError('Zoom says the meeting is full.');
    }
  }

  /** How many bots may load the join page at the same time. */
  private joinConcurrency(): number {
    const value = Number(this.config.get<string>('ZOOM_JOIN_CONCURRENCY', '5'));
    return Number.isInteger(value) && value > 0 ? value : 5;
  }

  private async clickJoin(page: Page): Promise<boolean> {
    for (const selector of this.joinSelectors()) {
      const el = await page.$(selector);
      if (el) {
        await el.click().catch(() => undefined);
        return true;
      }
    }
    // Fallback: any enabled button whose label looks like "Join".
    return page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((b) =>
        /^\s*join\b/i.test((b.textContent || '').trim()),
      );
      if (target) {
        (target as HTMLButtonElement).click();
        return true;
      }
      return false;
    });
  }

  /**
   * Best-effort handling of what shows up after clicking Join: a "Join Audio by
   * Computer" modal, a terms checkbox, etc. None of these are fatal if absent.
   */
  private async handlePostJoin(page: Page): Promise<void> {
    await this.sleep(5000);
    try {
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const audioBtn = buttons.find((b) =>
          /join audio by computer|join with computer audio/i.test(
            (b.textContent || '').trim(),
          ),
        );
        if (audioBtn) {
          (audioBtn as HTMLButtonElement).click();
          return true;
        }
        return false;
      });
      if (clicked) {
        this.logger.log('Dismissed the computer-audio prompt.');
      }
    } catch {
      // ignore — we are still in the meeting either way
    }
  }

  private async dismissCookieBanner(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const accept = buttons.find((b) =>
          /accept( all)? cookies|i agree|accept/i.test(
            (b.textContent || '').trim(),
          ),
        );
        if (accept) {
          (accept as HTMLButtonElement).click();
        }
      });
    } catch {
      // no banner; fine
    }
  }

  private async captureDebugScreenshot(
    page: Page,
    label: string,
  ): Promise<void> {
    const enabled =
      this.config.get<string>('ZOOM_DEBUG_SCREENSHOTS', 'true') !== 'false';
    if (!enabled) {
      return;
    }
    try {
      const dir = pathJoin(process.cwd(), 'debug-screenshots');
      await fs.mkdir(dir, { recursive: true });
      const file = pathJoin(dir, `${label}-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true });
      this.logger.warn(`Join failed — saved a debug screenshot to ${file}`);
    } catch (e) {
      this.logger.warn(`Could not save debug screenshot: ${e}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Lets at most `free` holders run at once; the rest wait their turn in order. */
class Slots {
  private readonly waiting: (() => void)[] = [];

  constructor(private free: number) {}

  /** Waits for a slot. The returned function frees it; extra calls are no-ops. */
  async acquire(): Promise<() => void> {
    if (this.free > 0) {
      this.free--;
    } else {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    let held = true;
    return () => {
      if (!held) {
        return;
      }
      held = false;
      const next = this.waiting.shift();
      if (next) {
        next(); // hand the slot straight over
      } else {
        this.free++;
      }
    };
  }
}
