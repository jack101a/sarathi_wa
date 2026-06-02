FROM node:20-slim

WORKDIR /app

# Copy root workspace manifests
COPY package.json package-lock.json ./

# Copy all packages (needed for workspace resolution)
COPY packages/common ./packages/common
COPY packages/gateway-tg ./packages/gateway-tg

# Copy legacy monolith src (business logic, actively used by workers)
COPY src ./src

RUN npm install --workspaces --if-present --include-workspace-root

WORKDIR /app/packages/gateway-tg

CMD ["node", "src/index.js"]
