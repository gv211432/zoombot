import { promises as fs } from 'node:fs';
import { join as pathJoin } from 'node:path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ParsedZoomLink } from './zoom-url.util';

interface MeetingSession {
  browser: Browser;
  page: Page;
  link: ParsedZoomLink;
  joinedAt: Date;
}

@Injectable()
export class ZoomService implements OnModuleDestroy {
  private readonly logger = new Logger(ZoomService.name);
  private readonly sessions = new Map<string, MeetingSession>();

  constructor(private readonly config: ConfigService) {}

  activeCount(): number {
    return this.sessions.size;
  }

  activeMeetingNumbers(): string[] {
    return [...this.sessions.keys()];
  }

  isInMeeting(meetingNumber: string): boolean {
    return this.sessions.has(meetingNumber);
  }

  /**
   * Open the Zoom web client in a headless browser and join the meeting as a
   * single, self-identified participant (muted, no video).
   */
  async join(link: ParsedZoomLink): Promise<void> {
    if (this.sessions.has(link.meetingNumber)) {
      throw new Error(`Already in meeting ${link.meetingNumber}.`);
    }

    const displayName = this.config.get<string>(
      'ZOOM_BOT_DISPLAY_NAME',
      'Zoombot (Notetaker)',
    );
    const stepTimeout = Number(
      this.config.get<string>('ZOOM_STEP_TIMEOUT_MS', '45000'),
    );

    const browser = await this.launchBrowser();
    let page: Page;
    try {
      page = await browser.newPage();
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
        throw new Error('Could not find the display-name input on the join page.');
      }

      await this.maybeTypePasscode(page, link.password);

      const joinOk = await this.clickJoin(page);
      if (!joinOk) {
        throw new Error('Could not find or click the Join button.');
      }

      await this.handlePostJoin(page);

      this.sessions.set(link.meetingNumber, {
        browser,
        page,
        link,
        joinedAt: new Date(),
      });
      this.logger.log(`Joined meeting ${link.meetingNumber}.`);
    } catch (err) {
      // Look the page up from the browser: `page` is unassigned if newPage() threw.
      await this.captureDebugScreenshot(
        await this.firstPage(browser),
        link.meetingNumber,
      );
      await browser.close().catch(() => undefined);
      throw err;
    }
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

  private async maybeTypePasscode(
    page: Page,
    password?: string,
  ): Promise<void> {
    if (!password) {
      return;
    }
    // The passcode field only appears when the pwd wasn't accepted from the URL.
    for (const selector of this.passcodeSelectors()) {
      const el = await page.$(selector);
      if (el) {
        await el.type(password, { delay: 20 });
        this.logger.log('Entered meeting passcode.');
        return;
      }
    }
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

  private async firstPage(browser: Browser): Promise<Page | undefined> {
    try {
      const pages = await browser.pages();
      return pages[0];
    } catch {
      return undefined;
    }
  }

  private async captureDebugScreenshot(
    page: Page | undefined,
    meetingNumber: string,
  ): Promise<void> {
    const enabled =
      this.config.get<string>('ZOOM_DEBUG_SCREENSHOTS', 'true') !== 'false';
    if (!enabled || !page) {
      return;
    }
    try {
      const dir = pathJoin(process.cwd(), 'debug-screenshots');
      await fs.mkdir(dir, { recursive: true });
      const file = pathJoin(dir, `${meetingNumber}-${Date.now()}.png`);
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
