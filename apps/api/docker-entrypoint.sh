#!/bin/bash
# Entrypoint da imagem de desenvolvimento (serviços migrate e api do docker-compose.yml).
# Prepara o workspace montado em /repo e executa o comando do serviço.
set -e

echo "📦 Instalando dependências..."
pnpm install --frozen-lockfile --ignore-scripts

echo "📦 Gerando Prisma Client e compilando @4frames/shared..."
pnpm db:generate
pnpm --filter @4frames/shared build

echo "🚀 Executando: $*"
exec "$@"
