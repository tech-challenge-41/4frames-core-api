#!/bin/bash
set -e

echo "🔧 Preparando ambiente..."

echo "📦 Instalando dependências..."
pnpm install --frozen-lockfile --ignore-scripts

echo "📦 Gerando Prisma Client e compilando @4frames/shared..."
pnpm db:generate
pnpm --filter @4frames/shared build

echo "🗄️  Aplicando migrations..."
pnpm db:deploy

echo "🌱 Populando banco de dados com dados iniciais..."
pnpm db:seed

echo "🚀 Iniciando aplicação..."
exec pnpm --filter @4frames/api dev
