# Imagem de produção do worker. O contexto de build é a raiz do monorepo:
#   docker build -f apps/worker/Dockerfile -t 4frames-worker .

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build

# Manifests primeiro, para reaproveitar o cache da instalação quando só o código muda.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/notifier/package.json apps/notifier/
COPY packages/shared/package.json packages/shared/

# --ignore-scripts: o postinstall da raiz precisa do código-fonte, que ainda não foi copiado.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/worker apps/worker

RUN pnpm --filter @4frames/shared db:generate \
  && pnpm --filter @4frames/shared build \
  && pnpm --filter @4frames/worker build

# Só o worker, com dependências de produção. O @4frames/shared entra como cópia (dist + prisma).
RUN pnpm --filter @4frames/worker deploy --prod --legacy /out

FROM node:24-alpine AS runtime
# Mesmo pacote do projeto base (apk add --no-cache ffmpeg): traz ffmpeg e ffprobe.
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production \
  WORKER_TMP_DIR=/tmp/4frames \
  WORKER_HEALTH_PORT=9100

COPY --from=build --chown=node:node /out ./
RUN mkdir -p /tmp/4frames && chown node:node /tmp/4frames

USER node
# /healthz para a liveness probe (e /metrics no Card 10)
EXPOSE 9100

# node como processo principal: recebe o SIGTERM do scale-down e termina o job atual antes de sair.
CMD ["node", "dist/main.js"]
