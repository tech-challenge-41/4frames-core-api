# Imagem de desenvolvimento da API (hot reload com o código montado em /repo).
# O contexto de build é a raiz do monorepo (ver docker-compose.yml).

FROM node:24-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl bash
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/notifier/package.json apps/notifier/
COPY packages/shared/package.json packages/shared/

# --ignore-scripts: o postinstall da raiz precisa do código-fonte (roda no entrypoint).
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh

COPY . .

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
