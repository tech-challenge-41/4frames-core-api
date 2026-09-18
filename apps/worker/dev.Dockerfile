# Imagem de desenvolvimento do worker: a mesma base da imagem de dev da API, com ffmpeg.
# O contexto de build é a raiz do monorepo (ver docker-compose.yml).

FROM node:24-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache openssl bash ffmpeg
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/notifier/package.json apps/notifier/
COPY packages/shared/package.json packages/shared/

# --ignore-scripts: o postinstall da raiz precisa do código-fonte (roda no entrypoint).
RUN pnpm install --frozen-lockfile --ignore-scripts

# O entrypoint é o mesmo da imagem de dev da API: instala, gera o Prisma Client, compila o shared e executa o comando.
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh

COPY . .

EXPOSE 9100

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# O docker-compose.yml define o comando (worker compilado, para o SIGTERM chegar ao Node).
CMD ["pnpm", "--filter", "@4frames/worker", "dev"]
