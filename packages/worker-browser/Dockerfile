# syntax=docker/dockerfile:1
### Stage 1: Install production dependencies
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_audit=false \
    npm_config_fund=false
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

### Stage 2: Runtime image
FROM node:20-bookworm-slim AS runtime
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/99rootless-sandbox \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    ca-certificates \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV APP_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_HEADLESS=true
ENV PUPPETEER_DISABLE_SANDBOX=true

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY packages/common ./packages/common
COPY packages/worker-browser ./packages/worker-browser
COPY src ./src
COPY models ./models
COPY config.example.yml ./

# Install Playwright chromium browser and its OS dependencies
RUN npx playwright install --with-deps chromium

CMD ["node", "packages/worker-browser/src/index.js"]
