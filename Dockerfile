# syntax=docker/dockerfile:1

### Stage 1: Build Frontend (React Admin Dashboard)
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
# Use ci if lock file present, else install (handles first-time builds)
RUN npm ci || npm install
COPY frontend/ .
RUN npm run build

### Stage 2: Install Node.js production dependencies
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV npm_config_build_from_source=sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm rebuild sqlite3 --build-from-source

### Stage 3: Runtime image (multi-arch: linux/amd64 + linux/arm64)
FROM node:20-bookworm-slim AS runtime

# Install system Chromium — let it pull its own dependencies automatically.
# Only fonts, curl (health check), and ca-certificates are added explicitly.
# This avoids brittle hand-rolled lib lists that break across bookworm ABI transitions.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    ca-certificates \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ARG PORT=3000
ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=${PORT}

# Puppeteer — use system Chromium, skip download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_HEADLESS=true
ENV PUPPETEER_DISABLE_SANDBOX=true
ENV PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage

# App file paths
ENV CONFIG_FILE=data/config.yml
ENV AUTO_TRACK_STORE_FILE=data/tracked_applications.json
ENV VAHAN_TRACK_STORE_FILE=data/vahan_tracked_applications.json
ENV TEMP_DIR=data/tmp

# Scalability defaults
ENV SESSION_POOL_SIZE=3
ENV MAX_BROWSER_PAGES=5
ENV API_CONCURRENCY=8
ENV BROWSER_CONCURRENCY=2
ENV LOG_LEVEL=info

WORKDIR /app

# Copy prod dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

RUN npx playwright install --with-deps

# Copy built React admin frontend from frontend-builder stage
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Copy application source
COPY . .

# Ensure required data directories exist
RUN mkdir -p /app/data/tmp /app/data /app/.wwebjs_auth


# WhatsApp session volume
VOLUME ["/app/.wwebjs_auth"]

# Healthcheck against the admin HTTP server
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE ${PORT}
CMD ["node", "server.js"]
