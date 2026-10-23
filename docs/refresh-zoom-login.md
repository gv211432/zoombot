# Refreshing the Zoom login on Railway

Use this when the Zoom session cookies on Railway expire (bots start
hitting `sign-in-required` again) or when you want to switch to a
different Zoom account.

## Prerequisites

- The laptop you log in on must be on a residential IP (not a VPN /
  VPS), otherwise Zoom's bot-detection will reject the login too.
- You still have the latest `main`/`production` code deployed on
  Railway (contains `POST /admin/upload-profile`).

## Steps

### 1. Set a one-time upload token on Railway

Railway dashboard → `zoombot` service → **Variables** → add:

```
ADMIN_UPLOAD_TOKEN=<generate a long random string, e.g. `openssl rand -hex 32`>
```

Save. Railway redeploys. Wait for `Zoombot is up` in the logs.

### 2. Log in on your laptop

```bash
cd ~/App/Gaurav.one/zoombot

# wipe any old profile (sudo if docker left root-owned files)
sudo rm -rf zoom-profile

# make sure .env has the Zoom credentials you want to use
# ZOOM_EMAIL=...
# ZOOM_PASSWORD=...

# visible browser so you can solve CAPTCHA / 2FA
PUPPETEER_HEADLESS=false npm run start:dev
```

In Telegram → send `/zoomlogin` → a Chrome window opens on your laptop
→ complete the login + any challenge → window closes.

Verify the cookies landed:

```bash
ls zoom-profile/Default/Cookies   # must exist
```

Stop the local bot (`Ctrl+C`).

### 3. Pack it

```bash
tar czf zp.tgz zoom-profile
ls -lh zp.tgz    # typically 5-15 MB
```

### 4. Pause Telegram collisions (optional but recommended)

If you want to make sure the next `/join` after upload is handled by
Railway (not a stray local process), kill any local listeners:

```bash
pkill -f "nest start"
pkill -f "dist/main"
```

### 5. Upload to Railway

Fill in the token you set in step 1 and your Railway public domain:

```bash
curl -X POST \
     -H "X-Admin-Token: PASTE_ADMIN_UPLOAD_TOKEN" \
     --data-binary @zp.tgz \
     https://PASTE_RAILWAY_DOMAIN/admin/upload-profile
```

Expected response:

```json
{"ok":true,"path":"/app/zoom-profile"}
```

Railway logs will show:

```
Receiving profile tarball (NNNNN bytes) → /tmp/...
Extracting into /app/zoom-profile
Zoom profile installed at /app/zoom-profile.
```

### 6. Remove the upload token

Railway dashboard → `zoombot` → **Variables** → delete
`ADMIN_UPLOAD_TOKEN`. The endpoint auto-disables when the variable is
missing. Save → Railway redeploys. The uploaded profile stays in the
volume.

### 7. Smoke test

In Telegram:

```
/join <meeting link>   # 1 bot first
```

Railway logs should show `Bot 1 in …: in-meeting` with no
`sign-in-required`. If that works, scale up (10 → 50 → 100).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 403 Upload endpoint is disabled` | `ADMIN_UPLOAD_TOKEN` not set on Railway | redo step 1 |
| `HTTP 403 Invalid or missing X-Admin-Token header` | Token mismatch | re-copy the token from Railway Variables |
| `HTTP 500 EBUSY: … rmdir '/app/zoom-profile'` | Volume mount, old code | pull latest `production` — fixed in commit `6c20ce8` |
| Upload succeeds but bots still `sign-in-required` | Login session didn't actually land (laptop was on a VPN, or the window was closed before `profile/Default/Cookies` was written) | redo step 2 and verify the Cookies file exists before packing |
| `Navigation timeout … exceeded` during `/zoomlogin` | Zoom showed CAPTCHA / 2FA that wasn't solved in time | repeat and solve the challenge within 3 minutes |
