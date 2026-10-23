import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, {
  Browser,
  ElementHandle,
  Page,
} from 'puppeteer';
// Note: we deliberately do NOT use puppeteer-extra / stealth plugin.
// Its target-tracking hook calls Target.setAutoAttach on every new target,
// and on Puppeteer 23 + modern Chromium many short-lived auxiliary targets
// (service workers, prerender frames) close before the hook attaches,
// surfacing as "Protocol error (Target.setAutoAttach): Target closed" and
// aborting the whole join. The fingerprint spoofing stealth would do is
// applied directly below in spoofMacFingerprint instead.
import { NameGeneratorService } from '../name-generator/name-generator.service';
import { ParsedZoomLink } from './zoom-url.util';

/** The most bot participants one join may ask for. */
export const MAX_BOTS_PER_MEETING = 500;

/** Bots that fail one after another before we stop starting new ones. */
const MAX_FAILURES_IN_A_ROW = 3;

/** How often to look for bots whose meeting ended, to free their browser tabs. */
const SWEEP_INTERVAL_MS = 30_000;

/** Failure screenshots kept on disk; older ones are deleted. */
const MAX_SCREENSHOTS = 20;

/** After we fill a passcode/email, how long Zoom may keep showing the field before we call it rejected. */
const DETAIL_ACCEPT_WAIT_MS = 15_000;

/** Appended to every generated name so the room can tell the bots from people. */
const BOT_NAME_TAG = '';

/** Subdirectory inside cwd where Chromium persists its login cookies/profile. */
const ZOOM_PROFILE_SUBDIR = 'zoom-profile';

/** Details only some meetings ask for; the user supplies them on request. */
export interface JoinDetails {
  passcode?: string;
  email?: string;
}

export type JoinNeed = keyof JoinDetails;

const MISSING_DETAIL: Record<JoinNeed, string> = {
  passcode: 'This meeting needs a passcode.',
  email: 'This meeting asks for an email address (usually a webinar).',
};

const REJECTED_DETAIL: Record<JoinNeed, string> = {
  passcode: 'Zoom rejected that passcode.',
  email: 'Zoom rejected that email address.',
};

/** Zoom asked for a detail we don't have: ask the user, then join again. */
export class JoinNeedsInputError extends Error {
  constructor(
    readonly need: JoinNeed,
    message: string,
  ) {
    super(message);
  }
}

/** The join was stopped with leave() before it finished. */
export class JoinCancelledError extends Error {}

/** A bot couldn't join; carries what the page showed, when it could be captured. */
export class JoinFailedError extends Error {
  screenshot?: Buffer;
}

/** The meeting won't admit any bot (ended, invalid, signed-in users only). */
class MeetingClosedError extends JoinFailedError {}

/** The meeting is at its participant limit, so no further bot will get in. */
class MeetingFullError extends JoinFailedError {}

/** Places a bot can sit after clicking Join that the user should hear about. */
export type JoinWait = 'waiting-room' | 'waiting-for-host';

export interface JoinEvents {
  /** Called once per waiting state (e.g. the waiting room). */
  onWait?: (state: JoinWait) => void;
  /** Called if the bots later leave without being asked (meeting ended, all removed). */
  onEnded?: (reason: string) => void;
}

export interface JoinResult {
  /** Display names of the bots now in the meeting. */
  joined: string[];
  /** Bots that didn't get in: they failed, or never started once joining stopped. */
  failed: number;
  /** Why the first of them failed. */
  failureReason?: string;
  /** What that bot's page showed when it failed. */
  failureScreenshot?: Buffer;
}

type JoinState =
  | JoinWait
  | 'in-meeting'
  | 'wrong-passcode'
  | 'sign-in-required'
  | 'unavailable'
  | 'full'
  | 'pending';

interface BotTab {
  name: string;
  page: Page;
}

/** One meeting's browser and the bots in it, tracked from the start of the join. */
interface MeetingSession {
  browser: Browser;
  link: ParsedZoomLink;
  /** Bots in the meeting; grows while the join is still running. */
  bots: BotTab[];
  joining: boolean;
  onEnded?: (reason: string) => void;
  /** Per-session copy of the Chromium profile; removed on leave. */
  profileDir?: string;
}

@Injectable()
export class ZoomService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZoomService.name);
  /** Per meeting number: meetings the bots are in or joining. */
  private readonly sessions = new Map<string, MeetingSession>();
  private sweepTimer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly names: NameGeneratorService,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  activeCount(): number {
    return this.sessions.size;
  }

  activeMeetingNumbers(): string[] {
    return [...this.sessions.keys()];
  }

  /** True while the bots are in the meeting or still joining it. */
  isInMeeting(meetingNumber: string): boolean {
    return this.sessions.has(meetingNumber);
  }

  isJoining(meetingNumber: string): boolean {
    return this.sessions.get(meetingNumber)?.joining ?? false;
  }

  /** The display names of the bots in a meeting so far. */
  displayNamesIn(meetingNumber: string): string[] {
    return this.sessions.get(meetingNumber)?.bots.map((b) => b.name) ?? [];
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
   * leave() during the join stops it and makes this throw JoinCancelledError.
   *
   * @param details passcode/email, for meetings whose join page asks for them
   * @throws JoinNeedsInputError when Zoom asks for a detail not in `details`
   */
  async join(
    link: ParsedZoomLink,
    details: JoinDetails,
    botCount: number,
    events: JoinEvents = {},
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
    if (this.sessions.has(meetingNumber)) {
      throw new Error(`Already in or joining meeting ${meetingNumber}.`);
    }
    const profileDir = await this.cloneProfileForSession(meetingNumber);
    const browser = await this.launchBrowser(profileDir);
    const proc = browser.process();
    proc?.on('exit', (code, signal) => {
      this.logger.warn(
        `Chromium for ${meetingNumber} exited (code=${code}, signal=${signal})`,
      );
    });
    browser.on('disconnected', () => {
      this.logger.warn(`Puppeteer browser for ${meetingNumber} disconnected`);
    });
    const session: MeetingSession = {
      browser,
      link,
      bots: [],
      joining: true,
      onEnded: events.onEnded,
      profileDir,
    };
    this.sessions.set(meetingNumber, session);
    try {
      return await this.joinAll(session, details, botCount, events.onWait);
    } catch (err) {
      if (this.sessions.get(meetingNumber) === session) {
        await this.leave(meetingNumber);
      }
      throw err;
    } finally {
      session.joining = false;
    }
  }

  private async joinAll(
    session: MeetingSession,
    details: JoinDetails,
    botCount: number,
    onWait?: (state: JoinWait) => void,
  ): Promise<JoinResult> {
    const { browser, link } = session;
    const displayNames = this.pickDisplayNames(botCount);
    // Loading the join page is the heavy part, so only a few bots do it at
    // once; each frees its slot as soon as it has clicked Join.
    const slots = new Slots(this.joinConcurrency());
    // leave() removes the session and closes the browser under the bots.
    const cancelled = () => this.sessions.get(link.meetingNumber) !== session;

    // The bots land in the same waiting room; tell the user once.
    const announced = new Set<JoinWait>();
    const announce = (state: JoinWait) => {
      if (!announced.has(state)) {
        announced.add(state);
        onWait?.(state);
      }
    };

    let firstError: unknown;
    let fatal = false; // the meeting won't take any bot: everyone leaves
    let stopped = false; // no point starting more bots
    let failuresInARow = 0;

    await Promise.all(
      displayNames.map(async (name, i) => {
        const release = await slots.acquire();
        try {
          if (stopped || cancelled()) {
            return;
          }
          const tab = await this.joinAs(browser, link, details, name, i + 1, announce, () => {
            failuresInARow = 0;
            release();
          });
          session.bots.push(tab);
        } catch (err) {
          if (fatal || cancelled()) {
            return; // the browser was closed under this bot
          }
          firstError ??= err;
          if (err instanceof JoinNeedsInputError || err instanceof MeetingClosedError) {
            // If other bots are already in the meeting, this must be a
            // per-bot block (Zoom's bot-detection on one tab, or a rate
            // limit), not a meeting-wide problem — tearing the browser
            // down would kick the siblings that already made it in. Just
            // stop spawning more; let the ones in stay in.
            if (session.bots.length > 0) {
              stopped = true;
            } else {
              fatal = stopped = true;
              firstError = err;
              await browser.close().catch(() => undefined);
            }
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

    if (cancelled()) {
      throw new JoinCancelledError(`Stopped joining meeting ${link.meetingNumber}.`);
    }
    if (fatal || session.bots.length === 0) {
      throw firstError; // join() closes the browser
    }

    const joined = session.bots.map((b) => b.name);
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
      failureScreenshot:
        failed > 0 && firstError instanceof JoinFailedError
          ? firstError.screenshot
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
  ): Promise<BotTab> {
    const stepTimeout = Number(
      this.config.get<string>('ZOOM_STEP_TIMEOUT_MS', '45000'),
    );

    // Each bot gets its own browser context so cookies, localStorage and
    // IndexedDB are isolated. Without this, every tab shares Zoom's session
    // state and the newest join silently kicks every earlier bot out of the
    // meeting — only the last tab survives.
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      const chromeVersion = await this.spoofMacFingerprint(browser, page);

      this.logger.log(
        `Opening web client for meeting ${link.meetingNumber} as "${displayName}" (Chrome ${chromeVersion})`,
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

      // A passcode field shows when the link doesn't carry one (no ?pwd=), and
      // webinars may want an email. Some meetings ask only after Join, which
      // waitUntilAdmitted handles.
      const filled = new Map<JoinNeed, number>();
      await this.fillDetailFields(page, details, filled);

      const joinOk = await this.clickJoin(page);
      if (!joinOk) {
        throw new Error('Could not find or click the Join button.');
      }
      joinClicked();

      await this.waitUntilAdmitted(
        page,
        details,
        filled,
        `Bot ${botNumber} in ${link.meetingNumber}`,
        onWait,
      );
      await this.handlePostJoin(page);
      return { name: displayName, page };
    } catch (err) {
      // A missing detail isn't a page problem, and once the browser is closed
      // (the whole join stopped) there's no page left to capture.
      if (err instanceof JoinNeedsInputError || !browser.connected) {
        throw err;
      }
      const failure =
        err instanceof JoinFailedError
          ? err
          : new JoinFailedError(
              `Bot ${botNumber} ("${displayName}"): ${err instanceof Error ? err.message : String(err)}`,
            );
      failure.screenshot = await this.captureDebugScreenshot(
        page,
        `${link.meetingNumber}-bot${botNumber}`,
      );
      // A closed meeting ends the whole join; otherwise only this bot leaves.
      if (!(failure instanceof MeetingClosedError)) {
        await page.close().catch(() => undefined);
      }
      throw failure;
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

  /**
   * Leave a meeting, or stop joining it, by closing its browser: every bot's
   * tab goes, and with it the memory it held.
   */
  async leave(meetingNumber: string): Promise<boolean> {
    const session = this.sessions.get(meetingNumber);
    if (!session) {
      return false;
    }
    this.sessions.delete(meetingNumber);
    await session.browser.close().catch((e) =>
      this.logger.warn(`Error closing browser for ${meetingNumber}: ${e}`),
    );
    if (session.profileDir) {
      await fs.rm(session.profileDir, { recursive: true, force: true }).catch(
        (e) => this.logger.warn(`Error removing profile ${session.profileDir}: ${e}`),
      );
    }
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
    clearInterval(this.sweepTimer);
    await this.leaveAll();
  }

  /**
   * Free the tabs of bots that are no longer in their meeting (it ended, or
   * the host removed them). A meeting with no bots left is closed entirely
   * and the user told why.
   */
  private async sweep(): Promise<void> {
    if (this.sweeping) {
      return;
    }
    this.sweeping = true;
    try {
      for (const [meetingNumber, session] of this.sessions) {
        if (session.joining) {
          continue; // the join handles its own bots until it finishes
        }
        let reason = 'the browser stopped unexpectedly';
        if (session.browser.connected) {
          reason = 'the meeting ended or the host removed them';
          for (const bot of [...session.bots]) {
            if (bot.page.isClosed() || (await this.readJoinState(bot.page)) === 'unavailable') {
              await bot.page.close().catch(() => undefined);
              session.bots.splice(session.bots.indexOf(bot), 1);
              this.logger.log(`Bot "${bot.name}" is no longer in meeting ${meetingNumber}; closed its tab.`);
            }
          }
          if (session.bots.length > 0) {
            continue;
          }
        }
        // leave() may have run while we were checking.
        if (this.sessions.get(meetingNumber) === session) {
          await this.leave(meetingNumber);
          session.onEnded?.(reason);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────

  /** Absolute path to the persisted Chromium profile directory. */
  private zoomProfileDir(): string {
    const override = this.config.get<string>('ZOOM_PROFILE_DIR', '').trim();
    return override || pathJoin(process.cwd(), ZOOM_PROFILE_SUBDIR);
  }

  /**
   * Returns true when a Zoom session cookie exists in the persisted profile,
   * meaning the bot previously logged in and the session is likely still valid.
   */
  async isLoggedIn(): Promise<boolean> {
    const cookiePath = pathJoin(this.zoomProfileDir(), 'Default', 'Cookies');
    try {
      await fs.access(cookiePath);
      // The cookie file exists — we have logged in at least once.
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Open Zoom's sign-in page in a (non-headless) browser, fill in the
   * credentials from env, wait for the dashboard to load, then close.
   * The Chromium profile is persisted to disk so every subsequent `join`
   * reuses the authenticated session.
   *
   * @throws if credentials are missing, the login form is not found, or
   *         Zoom rejects the password.
   */
  async loginWithAccount(): Promise<void> {
    const email = this.config.get<string>('ZOOM_EMAIL', '').trim();
    const password = this.config.get<string>('ZOOM_PASSWORD', '').trim();
    if (!email || !password) {
      throw new Error(
        'ZOOM_EMAIL and ZOOM_PASSWORD must be set in the environment before logging in.',
      );
    }

    const profileDir = this.zoomProfileDir();
    await fs.mkdir(profileDir, { recursive: true });
    this.logger.log(`Starting Zoom login for ${email} (profile: ${profileDir})`);

    // Use a visible browser for login so any CAPTCHA can be spotted; set
    // PUPPETEER_HEADLESS=false in .env while debugging if needed.
    const browser = await this.launchBrowser(profileDir);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await this.spoofMacFingerprint(browser, page);

      this.logger.log('Navigating to Zoom sign-in page…');
      await page.goto('https://zoom.us/signin', {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      });

      // If already signed in, Zoom redirects to /profile.
      if (/\/profile/i.test(new URL(page.url()).pathname)) {
        this.logger.log('Already signed in to Zoom.');
        return;
      }

      // The cookie banner sits on top of the Next button and blocks clicks.
      await this.dismissCookieBanner(page);

      // Zoom's sign-in is a two-step flow: fill email → click Next → the
      // password field is only mounted after email is accepted. Supporting
      // both the new (#email_input, #zm_signin_email) and old (#email) ids.
      const emailFilled = await this.typeIntoFirst(
        page,
        ['#email_input', '#zm_signin_email', '#email', 'input[name="email"]', 'input[type="email"]'],
        email,
        15_000,
      );
      if (!emailFilled) {
        throw new Error('Could not find the email field on the Zoom sign-in page.');
      }

      // Click the "Next" button that advances to the password step. Some
      // layouts put a submit button here; others use a button labelled Next.
      const nextClicked = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLButtonElement>('button, input[type="submit"]'),
        );
        const next = candidates.find((b) => {
          const label = (b.getAttribute('aria-label') || b.textContent || (b as HTMLInputElement).value || '').trim();
          return /^next$/i.test(label) || /continue/i.test(label);
        });
        if (next) {
          next.click();
          return true;
        }
        return false;
      });
      if (!nextClicked) {
        this.logger.warn('No "Next" button found; assuming legacy one-step sign-in form.');
      }

      // Password field appears after Next; give it a generous timeout because
      // Zoom may do a round-trip to validate the email first.
      const pwFilled = await this.typeIntoFirst(
        page,
        ['#password', '#password_input', 'input[name="password"]', 'input[type="password"]'],
        password,
        20_000,
      );
      if (!pwFilled) {
        // If the email was rejected (unknown account, SSO-only, …) Zoom shows
        // an inline error on the email step instead of moving on.
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (/can.?t find.*account|no account|use (your )?SSO|single sign.?on/i.test(bodyText)) {
          throw new Error(
            'Zoom did not accept this email on the sign-in page — the account ' +
              'may not exist, or it requires SSO (which this bot cannot use).',
          );
        }
        throw new Error(
          'Password field never appeared after submitting the email. Zoom may be ' +
            'showing a CAPTCHA or extra challenge — check the debug screenshot.',
        );
      }

      // Click Sign In.
      await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLButtonElement>('button, input[type="submit"]'),
        );
        const signIn = candidates.find((b) => {
          const label = (b.getAttribute('aria-label') || b.textContent || (b as HTMLInputElement).value || '').trim();
          return /^sign ?in$/i.test(label) || /^log ?in$/i.test(label);
        });
        if (signIn) {
          signIn.click();
        } else {
          // Fallback: any submit button on the form.
          const anySubmit = document.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]');
          anySubmit?.click();
        }
      });

      // Wait for post-login navigation (profile page, or 2FA, etc.).
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60_000 });

      const finalUrl = page.url();
      if (/\/signin/i.test(new URL(finalUrl).pathname)) {
        // Still on the sign-in page — wrong credentials or CAPTCHA.
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (/invalid|incorrect|wrong|error/i.test(bodyText)) {
          throw new Error(
            'Zoom rejected the credentials (wrong email or password).',
          );
        }
        throw new Error(
          'Still on the sign-in page after submitting — a CAPTCHA or 2-step ' +
            'verification may be blocking the login. Check ZOOM_DEBUG_SCREENSHOTS.',
        );
      }

      this.logger.log(`Zoom login succeeded (landed on ${finalUrl})`);
    } catch (err) {
      // Save a debug screenshot before re-throwing.
      await this.captureDebugScreenshot(page, 'zoom-login-failed');
      throw err;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Make the page look like it's running on macOS so reCAPTCHA's platform
   * cross-checks (UA, navigator.platform, userAgentData.platform, WebGL
   * vendor) all agree. The stealth plugin masks headless signals; this layer
   * flips the OS story from Linux to Mac. Returns the Chrome major version
   * that was baked into the UA so callers can log it.
   */
  private async spoofMacFingerprint(browser: Browser, page: Page): Promise<string> {
    const realVersion = await browser.version(); // e.g. "Chrome/131.0.6778.204"
    const chromeVersion = realVersion.match(/\/(\d+\.\S+)/)?.[1] ?? '131.0.6778.204';
    const majorVersion = chromeVersion.split('.')[0];
    const macUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    await page.setUserAgent(macUA);

    // Lie about the OS at every layer the reCAPTCHA iframe inspects.
    await page.evaluateOnNewDocument((version: string) => {
      // Hide the headless/automated signals that puppeteer-extra-stealth
      // used to cover for us.
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      } catch {
        /* already defined */
      }
      // navigator.languages — headless Chrome defaults to [] on some builds.
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      // navigator.plugins — real browsers expose a non-empty PluginArray.
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer' },
          { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer' },
        ],
      });
      // window.chrome — stealth's chrome.runtime/app/csi/loadTimes evasion.
      // Zoom's bot heuristics check for this object's shape.
      if (!(window as any).chrome) {
        (window as any).chrome = {
          runtime: {},
          app: { isInstalled: false },
          csi: () => undefined,
          loadTimes: () => undefined,
        };
      }
      // navigator.permissions.query — headless returns 'denied' for
      // notifications where a real browser returns 'default'/'prompt'.
      const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
      if (originalQuery) {
        navigator.permissions.query = (parameters: any) =>
          parameters?.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(parameters);
      }

      // navigator.platform — still read by many sites despite being deprecated.
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

      // Realistic Mac hardware. A docker container reports host CPU/memory,
      // which can be an obvious outlier (e.g. 32 cores). Pin to a common
      // MacBook configuration.
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      // Mac desktop has no touchscreen; headless default is often 0 already
      // but set explicitly so cross-checks match.
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

      // Realistic MacBook screen metrics (14" MBP ≈ 1512×982 effective).
      Object.defineProperty(screen, 'width', { get: () => 1512 });
      Object.defineProperty(screen, 'height', { get: () => 982 });
      Object.defineProperty(screen, 'availWidth', { get: () => 1512 });
      Object.defineProperty(screen, 'availHeight', { get: () => 950 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 30 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 30 });
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 2 });

      // Realistic camera + mic devices so enumerateDevices doesn't return
      // the headless defaults (empty labels, generic ids).
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
        navigator.mediaDevices.enumerateDevices = async () => [
          { deviceId: 'default', kind: 'audioinput', label: 'Default - MacBook Pro Microphone', groupId: 'g1', toJSON: () => ({}) } as MediaDeviceInfo,
          { deviceId: 'communications', kind: 'audioinput', label: 'MacBook Pro Microphone', groupId: 'g1', toJSON: () => ({}) } as MediaDeviceInfo,
          { deviceId: 'default-out', kind: 'audiooutput', label: 'Default - MacBook Pro Speakers', groupId: 'g2', toJSON: () => ({}) } as MediaDeviceInfo,
          { deviceId: 'cam-1', kind: 'videoinput', label: 'FaceTime HD Camera', groupId: 'g3', toJSON: () => ({}) } as MediaDeviceInfo,
        ];
      }

      // navigator.userAgentData (UA-CH) — reCAPTCHA v3 uses this on Chromium.
      const brands = [
        { brand: 'Google Chrome', version },
        { brand: 'Chromium', version },
        { brand: 'Not=A?Brand', version: '99' },
      ];
      const uaData = {
        brands,
        mobile: false,
        platform: 'macOS',
        getHighEntropyValues: () =>
          Promise.resolve({
            architecture: 'x86',
            bitness: '64',
            brands,
            fullVersionList: brands,
            mobile: false,
            model: '',
            platform: 'macOS',
            platformVersion: '10.15.7',
            uaFullVersion: '10.15.7',
            wow64: false,
          }),
        toJSON: () => ({ brands, mobile: false, platform: 'macOS' }),
      };
      Object.defineProperty(navigator, 'userAgentData', { get: () => uaData });

      // WebGL vendor/renderer — Linux Docker reports Mesa/SwiftShader, a dead
      // giveaway. Spoof an Apple GPU string that matches a real Mac, both on
      // WebGL1 (WebGLRenderingContext) and WebGL2 (WebGL2RenderingContext).
      const patchWebGL = (proto: any) => {
        const original = proto.getParameter;
        proto.getParameter = function (param: number) {
          if (param === 37445) return 'Apple Inc.'; // UNMASKED_VENDOR_WEBGL
          if (param === 37446) return 'Apple M1'; // UNMASKED_RENDERER_WEBGL
          return original.call(this, param);
        };
      };
      patchWebGL(WebGLRenderingContext.prototype);
      if (typeof WebGL2RenderingContext !== 'undefined') {
        patchWebGL(WebGL2RenderingContext.prototype);
      }
    }, majorVersion);
    return chromeVersion;
  }

  /**
   * Copy the saved Zoom profile (if any) to a per-session scratch directory,
   * so concurrent meetings don't fight over Chrome's SingletonLock on the
   * shared profile. Returns the scratch dir, or undefined if no saved profile.
   */
  private async cloneProfileForSession(
    meetingNumber: string,
  ): Promise<string | undefined> {
    if (!(await this.isLoggedIn())) {
      return undefined;
    }
    const src = this.zoomProfileDir();
    const dst = pathJoin(tmpdir(), `zoom-profile-${meetingNumber}-${Date.now()}`);
    // Skip files that encode host-machine identity or stale lock state.
    // Chromium regenerates these; copying them from a host-created profile
    // into a container causes "another computer owns this profile" refusals
    // or outright crashes (Local State holds an OS-keyring-encrypted key).
    const SKIP = /\/(Singleton(Lock|Cookie|Socket)|lockfile|Local State|RunningChromeVersion)$/;
    await fs.cp(src, dst, {
      recursive: true,
      filter: (source) => !SKIP.test(source),
    });
    // Clear the "last run crashed" flag so Chromium doesn't try to show a
    // restore prompt (which, in headless, just stalls the handshake).
    await this.clearCrashedExitFlag(dst);
    return dst;
  }

  /** Rewrite exit_type / exited_cleanly in Preferences so Chrome doesn't nag. */
  private async clearCrashedExitFlag(profileDir: string): Promise<void> {
    const prefsPath = pathJoin(profileDir, 'Default', 'Preferences');
    try {
      const raw = await fs.readFile(prefsPath, 'utf8');
      const prefs = JSON.parse(raw);
      if (prefs?.profile) {
        prefs.profile.exit_type = 'Normal';
        prefs.profile.exited_cleanly = true;
        await fs.writeFile(prefsPath, JSON.stringify(prefs));
      }
    } catch {
      // No Preferences yet, or unreadable — Chromium will create a fresh one.
    }
  }

  private async launchBrowser(userDataDir?: string): Promise<Browser> {
    const headless =
      this.config.get<string>('PUPPETEER_HEADLESS', 'true') !== 'false';
    const dumpio =
      this.config.get<string>('PUPPETEER_DUMPIO', 'false') === 'true';
    return puppeteer.launch({
      // In Puppeteer v22+, headless:true uses Chrome's new headless mode
      // (same renderer as a real browser window), not the legacy shell.
      headless,
      userDataDir,
      dumpio,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Chrome 137+ deprecated the automatic software-WebGL fallback.
        // Inside this container there is no real GPU, so Zoom's WebGL-based
        // video pipeline fails to initialise and the client silently exits
        // right after login. Opt in to the SwiftShader software renderer.
        '--enable-unsafe-swiftshader',
        // Suppress the "Chrome is being controlled by automated software" flag
        // and the navigator.webdriver JS property that Zoom's detection reads.
        '--disable-blink-features=AutomationControlled',
        // Supply fake audio/video so Zoom's getUserMedia resolves instead of
        // hanging on a non-existent camera/mic, and so no permission prompt
        // blocks the flow.
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
   * Fill the passcode/email fields the page is showing, noting when each was
   * filled in `filled`. Returns true if it filled any. If one is showing and
   * we don't have the value, stop so the user can be asked for it; if Zoom
   * still shows it well after we filled it, the value was rejected.
   */
  private async fillDetailFields(
    page: Page,
    details: JoinDetails,
    filled: Map<JoinNeed, number>,
  ): Promise<boolean> {
    let filledAny = false;
    for (const need of ['passcode', 'email'] as const) {
      const selectors =
        need === 'passcode' ? this.passcodeSelectors() : this.emailSelectors();
      const field = await this.visibleField(page, selectors);
      if (!field) {
        continue;
      }
      if (/\/signin\b/i.test(new URL(page.url()).pathname)) {
        // Zoom's account sign-in form, not a meeting prompt; the next
        // readJoinState reports it as sign-in-required.
        return false;
      }
      const filledAt = filled.get(need);
      if (filledAt !== undefined) {
        // Zoom may take a moment to move on after we answer.
        if (Date.now() - filledAt > DETAIL_ACCEPT_WAIT_MS) {
          throw new JoinNeedsInputError(need, REJECTED_DETAIL[need]);
        }
        continue;
      }
      const value = details[need];
      if (!value) {
        throw new JoinNeedsInputError(need, MISSING_DETAIL[need]);
      }
      await field.click({ clickCount: 3 }); // select any prefilled text
      await field.type(value, { delay: 20 });
      filled.set(need, Date.now());
      filledAny = true;
    }
    return filledAny;
  }

  private async visibleField(
    page: Page,
    selectors: string[],
  ): Promise<ElementHandle | undefined> {
    for (const selector of selectors) {
      const field = await page.$(selector);
      if (field && (await field.isVisible())) {
        return field;
      }
    }
    return undefined;
  }

  /**
   * After clicking Join, wait until the bot is really in the meeting,
   * reporting waiting rooms on the way and failing fast on dead ends.
   */
  private async waitUntilAdmitted(
    page: Page,
    details: JoinDetails,
    filled: Map<JoinNeed, number>,
    label: string,
    onWait: (state: JoinWait) => void,
  ): Promise<void> {
    const timeout = Number(
      this.config.get<string>('ZOOM_ADMIT_TIMEOUT_MS', '300000'),
    );
    const deadline = Date.now() + timeout;
    let lastState: JoinState | undefined;
    while (Date.now() < deadline) {
      const state = await this.readJoinState(page);
      if (state !== lastState) {
        this.logger.log(`${label}: ${state}`);
        lastState = state;
      }
      if (state === 'in-meeting') {
        return;
      }
      if (state === 'wrong-passcode') {
        throw new JoinNeedsInputError('passcode', 'Zoom rejected that passcode.');
      }
      this.failIfBlocked(state);
      if (state === 'waiting-room' || state === 'waiting-for-host') {
        onWait(state);
      } else if (await this.fillDetailFields(page, details, filled)) {
        // A passcode/email asked for only after the first Join.
        this.logger.log(`${label}: answered a passcode/email prompt`);
        await this.clickJoin(page);
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
        // Zoom's account sign-in page (its email/password boxes aren't a
        // meeting passcode prompt).
        if (/\/signin\b/i.test(location.pathname)) {
          return 'sign-in-required';
        }
        const text = document.body.innerText;
        if (/incorrect (password|passcode)|(password|passcode) (is )?(wrong|incorrect)/i.test(text)) {
          return 'wrong-passcode';
        }
        // Zoom's explicit bot-block message — treat same as sign-in-required so
        // the join fails fast instead of looping for 5 minutes.
        if (/automated bots? (aren['’]t|are not) allowed/i.test(text)) {
          return 'sign-in-required';
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
        "This meeting only admits signed-in Zoom users, so the bots can't join it as guests. " +
          'If you host it, turn off "Only authenticated users can join meetings" and ' +
          '"Only authenticated users can join meetings from Web client" in the Zoom web ' +
          'portal under Settings → Meeting → Security (an account admin may have locked them).',
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

  /** Screenshot of a failed join, also saved under ./debug-screenshots. */
  private async captureDebugScreenshot(
    page: Page,
    label: string,
  ): Promise<Buffer | undefined> {
    const enabled =
      this.config.get<string>('ZOOM_DEBUG_SCREENSHOTS', 'true') !== 'false';
    if (!enabled) {
      return undefined;
    }
    try {
      const image = Buffer.from(await page.screenshot({ fullPage: true }));
      const dir = pathJoin(process.cwd(), 'debug-screenshots');
      await fs.mkdir(dir, { recursive: true });
      const file = pathJoin(dir, `${label}-${Date.now()}.png`);
      await fs.writeFile(file, image);
      this.logger.warn(`Join failed — saved a debug screenshot to ${file}`);
      await this.pruneScreenshots(dir);
      return image;
    } catch (e) {
      this.logger.warn(`Could not save debug screenshot: ${e}`);
      return undefined;
    }
  }

  /** Keep only the newest MAX_SCREENSHOTS files, so the disk doesn't fill up. */
  private async pruneScreenshots(dir: string): Promise<void> {
    // Names end in a Date.now() timestamp, so the oldest sort first.
    const timestamp = (f: string) => Number(f.match(/-(\d+)\.png$/)?.[1] ?? 0);
    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.png'))
      .sort((a, b) => timestamp(a) - timestamp(b));
    for (const file of files.slice(0, -MAX_SCREENSHOTS)) {
      await fs.rm(pathJoin(dir, file), { force: true });
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
