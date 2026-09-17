#!/bin/bash
# Entrypoint da imagem de desenvolvimento (serviços migrate e api do docker-compose.yml).
# Prepara o workspace montado em /repo e executa o comando do serviço.
set -e

echo "📦 Instalando dependências..."
pnpm install --frozen-lockfile --ignore-scripts

# SKIP_SHARED_BUILD=1: o serviço migrate já gerou o client e compilou o shared no /repo montado.
# Serviços que sobem juntos (api e worker) não podem reescrever os mesmos arquivos ao mesmo tempo.
if [ "${SKIP_SHARED_BUILD:-}" != "1" ]; then
  echo "📦 Gerando Prisma Client e compilando @4frames/shared..."
  pnpm db:generate
  pnpm --filter @4frames/shared build
fi

echo "🚀 Executando: $*"
exec "$@"
