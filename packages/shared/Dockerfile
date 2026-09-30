# Imagem das migrations e do seed (Job `migrate` no cluster). O contexto de build é a raiz do monorepo:
#   docker build -f packages/shared/Dockerfile -t 4frames-migrate .
#
# Não reaproveita a imagem da API: o CLI do Prisma, o tsx e o bcrypt, que o db:deploy e o db:seed usam, são
# devDependencies do @4frames/shared, e o `pnpm deploy --prod` das imagens dos apps os deixa de fora. O
# prisma.config.ts e o seed também importam fontes TypeScript do shared, que ficam na imagem.

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

# Só o @4frames/shared, com as devDependencies. --ignore-scripts porque o postinstall da raiz precisa do
# código-fonte; o rebuild em seguida roda os scripts das dependências, e o do Prisma deixa o motor de
# migrations dentro da imagem em vez de baixá-lo quando o Job rodar.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @4frames/shared \
  && pnpm --filter @4frames/shared rebuild

COPY tsconfig.base.json ./
COPY packages/shared packages/shared

RUN pnpm --filter @4frames/shared db:generate

FROM node:24-alpine AS runtime
WORKDIR /repo/packages/shared
ENV NODE_ENV=production \
  PATH=/repo/packages/shared/node_modules/.bin:$PATH

COPY --from=build --chown=node:node /repo /repo

USER node

# Rodar de novo é seguro: o migrate deploy só aplica o que falta, e o seed usa upsert.
CMD ["sh", "-c", "prisma migrate deploy && prisma db seed"]
