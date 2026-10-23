# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build  — compile TypeScript → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24.11.0-bookworm-slim AS builder

WORKDIR /app

# Install only what's needed to build (npm, nest-cli, tsc)
COPY package.json bun.lock* ./

# Use npm (always present on the node image) — bun.lock is kept for reference
# but we use npm install so the lockfile format doesn't cause issues.
# PUPPETEER_SKIP_DOWNLOAD=1 — we will install Chrome in the runtime stage only.
ENV PUPPETEER_SKIP_DOWNLOAD=1

RUN npm install

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

RUN npm run build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime  — Node + Chrome + compiled app
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24.11.0-bookworm-slim AS runtime

# ── 1. System dependencies for Chromium / Puppeteer on Debian Bookworm ───────
#    This is the comprehensive set required by Chrome for Testing 147 on Linux.
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core graphics & fonts. A fat font list matters: reCAPTCHA fingerprints
    # the browser by measuring text widths for a canonical list of fonts;
    # a Linux image with only a handful of fonts is a bot tell. We install a
    # representative Linux desktop set so canvas font detection matches what
    # a real desktop user has.
    ca-certificates \
    fonts-liberation \
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-noto-mono \
    fonts-dejavu \
    fonts-dejavu-core \
    fonts-dejavu-extra \
    fonts-roboto \
    fonts-droid-fallback \
    fonts-cantarell \
    fonts-inconsolata \
    fonts-lato \
    fonts-open-sans \
    fonts-urw-base35 \
    fonts-freefont-ttf \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    # Needed for headless Chrome GPU path
    libvulkan1 \
    # Virtual display so Chrome can run non-headless inside the container.
    # Non-headless mode is much harder for reCAPTCHA to fingerprint than
    # headless mode, which is a known-bad signal.
    xvfb \
    xauth \
    # Download utility
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── 2. Install production Node dependencies (without dev, without Chrome dl) ─
COPY package.json bun.lock* ./
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm install --omit=dev

# ── 3. Download the Chrome build that this Puppeteer version pins to ─────────
#    Omit the version tag so npx picks the exact revision Puppeteer expects,
#    avoiding a "Could not find Chrome (ver. X)" mismatch at runtime.
ENV PUPPETEER_CACHE_DIR=/root/.cache/puppeteer
RUN npx puppeteer browsers install chrome

# ── 4. Copy compiled app from builder ────────────────────────────────────────
COPY --from=builder /app/dist ./dist

# ── 5. Runtime env defaults (all overrideable at docker run / compose) ────────
#    TELEGRAM_BOT_TOKEN must be supplied at runtime.
ENV NODE_ENV=production \
    PUPPETEER_HEADLESS=false \
    ZOOM_STEP_TIMEOUT_MS=45000 \
    ZOOM_ADMIT_TIMEOUT_MS=300000 \
    ZOOM_JOIN_CONCURRENCY=5 \
    ZOOM_DEBUG_SCREENSHOTS=true \
    HEALTH_PORT=3000

# ── 6. Expose health-check port ───────────────────────────────────────────────
EXPOSE 3000

# Note: persistent storage is declared via Railway's Volume UI (mounted at
# /app/zoom-profile), not a Dockerfile VOLUME directive — Railway rejects
# VOLUME. For local docker-compose runs, the bind mounts in
# docker-compose.yml handle the same thing.

# ── 8. Health check ───────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# ── 9. Run Xvfb + the compiled app ───────────────────────────────────────────
#    Start Xvfb in the background on display :99, then exec node so its stdout
#    streams straight to `docker logs` (xvfb-run buffers output in a way that
#    hides Nest's startup logs). Chrome launched by Puppeteer picks up
#    DISPLAY=:99 and renders into the virtual framebuffer, which lets us run
#    non-headless — a much weaker fingerprint than headless Chrome.
RUN printf '#!/bin/sh\nset -e\nXvfb :99 -screen 0 1280x800x24 -nolisten tcp &\nexport DISPLAY=:99\nsleep 1\nexec node dist/main.js\n' > /usr/local/bin/start-with-xvfb && \
    chmod +x /usr/local/bin/start-with-xvfb
CMD ["/usr/local/bin/start-with-xvfb"]
