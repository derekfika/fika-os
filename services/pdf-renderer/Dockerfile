FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
