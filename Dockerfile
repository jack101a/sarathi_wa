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
COPY package*.json ./
RUN npm ci --omit=dev

### Stage 3: Runtime image (multi-arch: linux/amd64 + linux/arm64)
FROM node:20-bookworm-slim AS runtime

# Install system Chromium — works on both amd64 and arm64 via Debian bookworm apt
# Note: libasound2 renamed to libasound2t64 in bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto \
    ca-certificates \
    curl \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
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
