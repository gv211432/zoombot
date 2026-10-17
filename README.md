# Zoombot

A Telegram bot (NestJS + Bun) that makes **two** headless-browser clients join a
Zoom meeting from a link you send it. Right now they only *join* — each takes a
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
  overrides) will need updating. The bot saves a screenshot to
  `./debug-screenshots/` on failure to help with this.
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
# then edit .env and set TELEGRAM_BOT_TOKEN
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

## Usage (in Telegram)

| Action | What happens |
| --- | --- |
| Paste a Zoom link | Two bots join that meeting, e.g. "Arnab Chatterjee (bot)" and "Jasleen Sandhu (bot)" |
| Reply to a 🔒 question | If the link has no passcode (or Zoom rejects it), the bot asks for it and retries |
| `/cancel` | Drops a join that is waiting for your reply |
| `/status` | Lists the meetings the bot is currently in |
| `/leave [meetingNumber]` | Leaves one meeting, or all meetings if omitted |
| `/whoami` | Shows your Telegram user id (for the allow-list) |

Supported link shapes: `https://…zoom.us/j/{id}?pwd=…`, `/wc/join/{id}`,
`/wc/{id}/join`, `/s/{id}`, `/w/{id}`. Personal-link (`…/my/alias`) and
registration URLs are **not** supported — send the numeric `/j/` link.

### Restricting who can use it

Set `TELEGRAM_ALLOWED_USER_IDS` in `.env` to a comma-separated list of numeric
Telegram user ids (use `/whoami` to find yours). Leave empty to allow anyone who
can message the bot.

## Project layout

```
src/
├── main.ts                  # bootstrap (HTTP health + Telegraf polling)
├── app.module.ts            # wires ConfigModule, TelegrafModule, modules
├── health.controller.ts     # GET /health
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
