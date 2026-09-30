# Imagem de produção da API. O contexto de build é a raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t 4frames-api .

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

FROM base AS build

# Manifests primeiro, para reaproveitar o cache da instalação quando só o código muda.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/notifier/package.json apps/notifier/
COPY packages/shared/package.json packages/shared/

# --ignore-scripts: o postinstall da raiz precisa do código-fonte, que ainda não foi copiado.
# A única dependência nativa (bcrypt) já traz binário pronto para Alpine (prebuilds/linux-x64/bcrypt.musl.node).
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @4frames/shared db:generate \
  && pnpm --filter @4frames/shared build \
  && pnpm --filter @4frames/api build

# Só a API, com dependências de produção. O @4frames/shared entra como cópia (dist + prisma).
RUN pnpm --filter @4frames/api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /out ./

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
