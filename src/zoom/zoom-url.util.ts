/**
 * Parsing of the many shapes a Zoom invite link can take, into the canonical
 * "join from your browser" (web client) URL that Puppeteer will open.
 *
 * Handled input shapes (host may be zoom.us or any vanity/subdomain like
 * us05web.zoom.us or acme.zoom.us):
 *   https://zoom.us/j/{mn}?pwd=...          ← most common
 *   https://{sub}.zoom.us/j/{mn}?pwd=...
 *   https://{sub}.zoom.us/wc/join/{mn}?pwd=...   (already a web-client link)
 *   https://{sub}.zoom.us/wc/{mn}/join?pwd=...
 *   https://{sub}.zoom.us/s/{mn}
 *   https://{sub}.zoom.us/w/{mn}?...
 *
 * Personal-link vanity URLs (…/my/alias) and /meeting/register links do not
 * carry a numeric meeting id and cannot be resolved offline — those return null.
 */
export interface ParsedZoomLink {
  rawUrl: string;
  host: string;
  meetingNumber: string;
  password?: string;
  /** The URL Puppeteer should open to join via the browser web client. */
  webClientUrl: string;
}

const ZOOM_URL_REGEX = /https?:\/\/[a-z0-9.-]*zoom\.us\/[^\s<>()"']+/i;

const MEETING_ID_PATTERNS: RegExp[] = [
  /\/j\/(\d+)/, // /j/{mn}
  /\/wc\/join\/(\d+)/, // /wc/join/{mn}
  /\/wc\/(\d+)\/join/, // /wc/{mn}/join
  /\/s\/(\d+)/, // /s/{mn}
  /\/w\/(\d+)/, // /w/{mn}
];

/** Pull the first Zoom URL out of an arbitrary chunk of Telegram message text. */
export function extractZoomUrl(text: string): string | null {
  const match = text.match(ZOOM_URL_REGEX);
  return match ? match[0] : null;
}

/** Parse a Zoom URL into its pieces + a canonical web-client join URL. */
export function parseZoomLink(rawUrl: string): ParsedZoomLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!/(^|\.)zoom\.us$/i.test(url.hostname)) {
    return null;
  }

  let meetingNumber: string | null = null;
  for (const pattern of MEETING_ID_PATTERNS) {
    const m = url.pathname.match(pattern);
    if (m) {
      meetingNumber = m[1];
      break;
    }
  }
  if (!meetingNumber) {
    return null;
  }

  const password = url.searchParams.get('pwd') ?? undefined;

  const webClientUrl = buildWebClientUrl(url.hostname, meetingNumber, password);

  return {
    rawUrl,
    host: url.hostname,
    meetingNumber,
    password,
    webClientUrl,
  };
}

function buildWebClientUrl(
  host: string,
  meetingNumber: string,
  password?: string,
): string {
  // Zoom redirects this to app.zoom.us/wc/{mn}/join, the web client's
  // name-and-join preview. Don't add fromPWA=1: it now bounces to the Zoom
  // Workplace sign-in landing page instead.
  const target = new URL(`https://${host}/wc/${meetingNumber}/join`);
  if (password) {
    target.searchParams.set('pwd', password);
  }
  return target.toString();
}
