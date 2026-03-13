# syntax=docker/dockerfile:1

### SECTION: Dependencies (The Prep Cook)
FROM node:20-bullseye-slim AS deps
WORKDIR /app

# 1. Keep the existing cache location and skip Puppeteer's bundled browser download.
ENV PUPPETEER_CACHE_DIR=/app/.cache
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
# 2. Install production dependencies only.
RUN npm ci --omit=dev


### SECTION: Runtime (The Head Chef)
FROM node:20-bullseye-slim AS runtime
ARG PORT=3000
ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=${PORT}

# 3. Point Puppeteer at the system Chromium installed in this image.
ENV PUPPETEER_CACHE_DIR=/app/.cache
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 4. Install the system Chromium package plus the shared libraries Puppeteer needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libgconf-2-4 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 5. Copy the installed dependencies from the prep cook.
COPY --from=deps /app/node_modules ./node_modules

# 6. Copy the rest of your app (bot.js, config.js, etc.)
COPY . .

# 7. Protect the WhatsApp session data so it survives container restarts
VOLUME ["/app/.wwebjs_auth"]

EXPOSE ${PORT}
CMD ["npm", "start"]
