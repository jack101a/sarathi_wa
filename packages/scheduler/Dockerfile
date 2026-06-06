# syntax=docker/dockerfile:1
### Stage 1: Install production dependencies
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=300000 \
    npm_config_audit=false \
    npm_config_fund=false
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

### Stage 2: Runtime image
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV APP_ENV=production

# PostgreSQL 16 client must match the PostgreSQL 16 server used by Compose.
RUN echo 'APT::Sandbox::User "root";' > /etc/apt/apt.conf.d/99rootless-sandbox \
    && touch /etc/inputrc \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl rclone \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/postgresql.asc \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && pg_dump --version | grep -q "16\\." \
    && pg_restore --version | grep -q "16\\." \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY packages/common ./packages/common
COPY packages/scheduler ./packages/scheduler
COPY src ./src
COPY config.example.yml ./

CMD ["node", "packages/scheduler/src/index.js"]
