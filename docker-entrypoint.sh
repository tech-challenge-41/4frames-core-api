#!/bin/bash
set -e

echo "🔧 Preparando ambiente..."

echo "📦 Instalando dependências..."
pnpm install --frozen-lockfile

echo "📦 Gerando Prisma Client..."
pnpm db:generate

echo "🗄️  Aplicando migrations..."
pnpm prisma migrate deploy

echo "🌱 Populando banco de dados com dados iniciais..."
pnpm db:seed

echo "🚀 Iniciando aplicação..."
exec pnpm dev
