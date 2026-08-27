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

## LocalStack (S3)

Uploads de vídeo usam URLs pré-assinadas do S3 (ver ADR-001). Em desenvolvimento local, o S3 é simulado com [LocalStack](https://www.localstack.cloud/).

```bash
docker compose up -d localstack
```

O bucket `4frames-videos` (nome configurável via `S3_BUCKET_NAME`) é criado automaticamente no bootstrap do container. Para verificar:

```bash
awslocal s3 ls
# ou, sem o awslocal instalado localmente:
aws --endpoint-url=http://localhost:4566 s3 ls
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
