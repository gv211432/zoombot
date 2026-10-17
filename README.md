# Zoombot

A Telegram bot (NestJS + Bun) that makes headless-browser clients join a Zoom
meeting from a link you send it — you choose how many (1–500) each time. Right
now they only *join* — each takes a
random Indian name tagged "(bot)", turns off camera/mic, and sits there. Note-taking
and summaries are deliberately not implemented yet; this is the foundation.

## ⚠️ Read this before you rely on it

This bot joins by **automating Zoom's in-browser web client** with Puppeteer. It
does **not** use the Zoom Meeting SDK, because Zoom's Meeting SDK docs now state
the SDK "is reserved for human use cases and does not support bots or AI
notetakers," pointing notetakers to **Zoom RTMS** instead.

Automating the web client is a **grey area under Zoom's general Terms of
Service**, and it is inherently fragile:

- Zoom changes its web-client HTML without notice. When a join starts failing,
  the CSS selectors in `src/zoom/zoom.service.ts` (or the `ZOOM_SEL_*` env
  overrides) will need updating. On failure the bot sends a screenshot of what
  Zoom showed to the Telegram chat (and keeps the newest 20 in
  `./debug-screenshots/`) to help with this.
- Only use it on meetings **you host or are authorised to join**, and keep the
  "(bot)" tag on display names so participants know bots are present.
  Many jurisdictions require consent to record/transcribe a meeting.
- If/when you add note-taking, the compliant long-term path is **Zoom RTMS**
  (real-time media streams). Consider migrating the join mechanism then.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.4 (used as package manager / runtime). Node ≥ 20 also
  works if you prefer `node`.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- Chromium is downloaded automatically by Puppeteer on install. On Linux servers
  you may need its shared libraries (e.g. `apt-get install -y libnss3 libatk1.0-0
  libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1
  libxrandr2 libgbm1 libasound2`).

## Setup

```bash
bun install
cp .env.example .env
# then edit .env and set TELEGRAM_BOT_TOKEN and BOT_PASSWORD
```

> 🔐 The bot token that was shared in chat should be considered compromised.
> Revoke it in @BotFather (`/mybots` → your bot → **API Token** → **Revoke
> current token**) and put the fresh token in `.env` — never commit `.env`.

## Run

```bash
# development (auto-reload)
bun run start:dev

# production
bun run build
bun run start:prod   # or: node dist/main.js
```

The process exposes `GET /health` (port from `HEALTH_PORT`, default 3000) and
polls Telegram for messages — no public URL/webhook required.

### Deploying on Railway

`railway.json` builds with `bun run build` and starts `bun run start:prod`;
Railpack installs Chromium's system libraries because Puppeteer is a
dependency. Telegram allows one poller per bot token, so while a redeploy
overlaps the old and new containers one of them gets a `409 Conflict`; the bot
logs it and polls again 10s later instead of crashing. If the 409 warning
keeps repeating, something else is running with the same token (a local
`bun run start:dev`, or another service) — stop it or give it its own token.

### Freeing memory

Every bot is a Chromium tab holding a few hundred MB. Every 30s the bot checks
on them: a bot whose meeting ended or who was removed by the host has its tab
closed, and once a meeting has no bots left its browser is shut and you get a
👋 message in Telegram. Leaving (button or `/leave`) closes the whole browser.

## Usage (in Telegram)

| Action | What happens |
| --- | --- |
| `/login <password>` | Starts a session; every other command (except `/whoami`) needs one |
| `/logout` | Ends your session now |
| Paste a Zoom link | The bot asks how many bots to send: tap a quick pick or type any number from 1 to 500. They join under names like "Arnab Chatterjee (bot)" |
| Reply to a 🔒 question | If the link has no passcode (or Zoom rejects it), the bot asks for it and retries |
| `/cancel` | Drops a join that is waiting for your reply |
| `/status` | Lists the meetings the bot is in (or joining), each with a 🚪 Leave button |
| 🚪 Leave button | On join messages and `/status`: the bots leave that meeting, or stop joining it |
| `/leave [meetingNumber]` | Leaves one meeting, or all meetings if omitted |
| `/whoami` | Shows your Telegram user id (for the allow-list) |

### Sending many bots

All bots for a meeting run as tabs in one headless Chromium, and each Zoom web
client tab needs a few hundred MB of RAM and real CPU. Plan on roughly
**one bot per 300–500 MB of free RAM**: a 16 GB laptop manages a few dozen, and
hundreds need a large server. Zoom also caps meetings (100 participants on
most plans by default), and bots count toward that cap.

- `ZOOM_JOIN_CONCURRENCY` (default 5) bots load the join page at a time; each
  frees its slot once it has clicked Join, so a waiting room doesn't hold up
  the rest.
- A problem with the meeting itself (needs a passcode, ended, signed-in users
  only) stops the whole join. A single bot failing only drops that bot, and the
  reply says how many got in and why the others didn't.
- New bots stop starting once Zoom says the meeting is full, or after 3 bots
  fail in a row.

### "This meeting only admits signed-in Zoom users"

The bots join as guests through Zoom's web client. If the host's account has
**Only authenticated users can join meetings** or **Only authenticated users can
join meetings from Web client** turned on (Zoom web portal → Settings → Meeting →
Security), Zoom asks for a sign-in and the bots can't get in. The host has to
turn those off (an account admin may have locked them); the bot does not sign
in to Zoom accounts. If the meeting hasn't started yet, Zoom may only show the
sign-in prompt once the host starts it.

Supported link shapes: `https://…zoom.us/j/{id}?pwd=…`, `/wc/join/{id}`,
`/wc/{id}/join`, `/s/{id}`, `/w/{id}`. Personal-link (`…/my/alias`) and
registration URLs are **not** supported — send the numeric `/j/` link.

### Restricting who can use it

Every user must log in with the password from `BOT_PASSWORD` in `.env` (the bot
refuses to start without one):

- Send `/login <password>`. The bot deletes that message where Telegram allows
  it (private chats, or groups where the bot is an admin).
- A session ends after **10 minutes** without a message from you; log in again
  to continue. Meetings the bots are already in are not affected.
- **Three** wrong passwords lock that Telegram user out for **10 minutes**.

Sessions and lockouts live in memory, so restarting the bot logs everyone out.

On top of the password, you can set `TELEGRAM_ALLOWED_USER_IDS` in `.env` to a
comma-separated list of numeric Telegram user ids (use `/whoami` to find yours).
Leave empty to let anyone who knows the password use the bot.

## Project layout

```
src/
├── main.ts                  # bootstrap (HTTP health + Telegraf polling)
├── app.module.ts            # wires ConfigModule, TelegrafModule, modules
├── health.controller.ts     # GET /health
├── auth/
│   ├── auth.module.ts
│   └── auth.service.ts      # password sessions, idle timeout, lockouts
├── name-generator/
│   ├── name-generator.module.ts
│   ├── name-generator.service.ts  # deterministic id → Indian name
│   └── names/               # first/last name lists, one file per religion
├── telegram/
│   ├── telegram.module.ts
│   └── telegram.update.ts   # Telegram commands + link handling
└── zoom/
    ├── zoom.module.ts
    ├── zoom.service.ts       # Puppeteer: open web client + join
    └── zoom-url.util.ts      # parse Zoom links → web-client join URL
```

## Name generator

`NameGeneratorModule` turns a numeric id into a stable Indian name. It holds
1,000 first and 1,000 last names split across eight religions — Hindu (600),
Muslim (160), Christian (75), Sikh (55), Buddhist, Jain, Zoroastrian (30 each)
and Jewish (20) — covering castes, regions and occupational surnames.

```ts
generateName(42);              // any of the 1,000,000 first × last pairings
generateName(42, 'sikh');      // both names drawn from the Sikh lists
maxNameId('sikh');             // 3025 (55 × 55) — valid ids are 1..maxNameId()
```

The same id always returns the same name, but editing or reordering the lists
in `src/name-generator/names/` reassigns names.

## Configuration reference

See `.env.example` — every variable is documented there.
