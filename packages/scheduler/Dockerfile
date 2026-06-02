# syntax=docker/dockerfile:1
### Stage 1: Install production dependencies
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

### Stage 2: Runtime image
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV APP_ENV=production

# Install postgresql-client so the backup job can run pg_dump
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY packages/common ./packages/common
COPY packages/scheduler ./packages/scheduler
COPY src ./src
COPY config.example.yml ./

CMD ["node", "packages/scheduler/src/index.js"]
