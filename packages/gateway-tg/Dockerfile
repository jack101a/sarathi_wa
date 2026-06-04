# syntax=docker/dockerfile:1
FROM node:20-slim

WORKDIR /app
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_audit=false \
    npm_config_fund=false

# Copy root workspace manifests
COPY package.json package-lock.json ./

# Copy all packages (needed for workspace resolution)
COPY packages/common ./packages/common
COPY packages/gateway-tg ./packages/gateway-tg

# Copy legacy monolith src (business logic, actively used by workers)
COPY src ./src
COPY config.example.yml ./

RUN npm ci --omit=dev

WORKDIR /app/packages/gateway-tg

CMD ["node", "src/index.js"]
