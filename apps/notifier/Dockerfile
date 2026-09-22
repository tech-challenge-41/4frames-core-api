# Imagem de produção do notifier. O contexto de build é a raiz do monorepo:
#   docker build -f apps/notifier/Dockerfile -t 4frames-notifier .

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
COPY apps/notifier apps/notifier

RUN pnpm --filter @4frames/shared db:generate \
  && pnpm --filter @4frames/shared build \
  && pnpm --filter @4frames/notifier build

# Só o notifier, com dependências de produção. O @4frames/shared entra como cópia (dist + prisma).
RUN pnpm --filter @4frames/notifier deploy --prod --legacy /out

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /out ./

USER node

CMD ["node", "dist/main.js"]
