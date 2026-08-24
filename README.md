# 4frames-core-api

API REST do núcleo 4Frames — autenticação de funcionários via JWT.

## Arquitetura

O projeto segue Clean/Hexagonal architecture com separação em camadas:

- `src/domain` — entidades, value objects, ports, domain errors
- `src/application` — use cases, DTOs, application errors
- `src/infra` — HTTP, database, services, logging
- `src/dependencies` — DI container (composition root)

## Desenvolvimento

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Testes

```bash
pnpm test
```

## Endpoints

- `POST /auth` — autenticação por email e senha
- `GET /health-check` — health check
- `GET /api-docs` — documentação OpenAPI

## Seeds

Usuários de teste (senha: `123456`):

| Email |
|-------|
| admin@admin.com |
| user@user.com |
