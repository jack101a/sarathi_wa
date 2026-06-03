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
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

### Stage 2: Runtime image
FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
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
COPY packages/gateway-wa ./packages/gateway-wa
COPY src ./src
COPY config.example.yml ./

# Create volume mount for whatsapp session data
RUN mkdir -p /app/.wwebjs_auth
VOLUME ["/app/.wwebjs_auth"]

CMD ["node", "packages/gateway-wa/src/index.js"]
