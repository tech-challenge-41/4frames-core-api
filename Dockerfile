FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --aggregate-output --network-concurrency 5

COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache openssl bash

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/infra/db/core/prisma ./src/infra/db/core/prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY docker-entrypoint-prod.sh /usr/local/bin/docker-entrypoint-prod.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-prod.sh && \
    sed -i 's/\r$//' /usr/local/bin/docker-entrypoint-prod.sh || true

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-prod.sh"]
