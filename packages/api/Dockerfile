# syntax=docker/dockerfile:1
### Stage 1: Build Frontend (React Admin Dashboard)
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

### Stage 2: Install production workspace dependencies
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

### Stage 3: Runtime image
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=3000

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=frontend-builder /frontend/dist ./frontend/dist
COPY package*.json ./
COPY packages/common ./packages/common
COPY packages/api ./packages/api
COPY src ./src

EXPOSE 3000
CMD ["node", "packages/api/src/index.js"]
