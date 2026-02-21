# syntax=docker/dockerfile:1

### SECTION: Dependencies (The Prep Cook)
FROM node:20-bullseye-slim AS deps
WORKDIR /app

# 1. Tell Puppeteer to download the bundled Chrome right here in our app folder
ENV PUPPETEER_CACHE_DIR=/app/.cache

COPY package*.json ./
# 2. This installs Node modules AND triggers the Puppeteer Chrome download into .cache
RUN npm ci --omit=dev


### SECTION: Runtime (The Head Chef)
FROM node:20-bullseye-slim AS runtime
ARG PORT=3000
ENV NODE_ENV=production
ENV APP_ENV=production
ENV PORT=${PORT}

# 3. Tell the runtime where to find that bundled browser we are about to copy over
ENV PUPPETEER_CACHE_DIR=/app/.cache

# 4. Install ONLY the underlying OS plumbing (graphical/audio libraries) 
# that the bundled Chrome needs. Notice there is no wget/google-chrome here!
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
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

# 5. Copy the node_modules AND the bundled Chrome cache from the prep cook
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.cache ./.cache

# 6. Copy the rest of your app (bot.js, config.js, etc.)
COPY . .

# 7. Protect the WhatsApp session data so it survives container restarts
VOLUME ["/app/.wwebjs_auth"]

EXPOSE ${PORT}
CMD ["npm", "start"]
