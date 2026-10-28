# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM toolchain AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM toolchain AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
# curl を入れずに済むよう Node の fetch で確認する
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server/index.js"]
