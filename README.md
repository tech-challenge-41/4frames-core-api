# 4frames-core-api

Monorepo do backend do 4Frames: conversão de vídeo em frames (`.zip`) com upload direto ao S3 via URL
pré-assinada, fila para processamento assíncrono e notificação por e-mail (ver ADR-001).

O front fica em [`4frames-web-app`](https://github.com/tech-challenge-41/4frames-web-app). Regras de
branch, commit e PR estão no [CONTRIBUTING.md](./CONTRIBUTING.md). Convenções de código estão no
[CLAUDE.md](./CLAUDE.md).

## Estrutura

| Pacote | Nome | O que é |
|---|---|---|
| `apps/api` | `@4frames/api` | API REST (Express 5): login JWT, jobs de vídeo e URLs pré-assinadas |
| `apps/worker` | `@4frames/worker` | Worker de processamento (scaffold; consumer SQS e ffmpeg no Card 2) |
| `apps/notifier` | `@4frames/notifier` | Notificador por e-mail (scaffold; assinatura de eventos no Card 4) |
| `packages/shared` | `@4frames/shared` | Prisma (schema, migrations, seeds e client), env, logger, contratos de job, clientes AWS e Redis |
| `infra/` | – | Scripts de init do LocalStack |

A API segue arquitetura hexagonal em `apps/api/src`: `domain` (ports e erros), `application`
(use cases e DTOs), `infra` (HTTP, serviços, logging) e `dependencies` (container de DI).

## Pré-requisitos

- Node.js 24 (ver `.nvmrc`) e pnpm 10
- Docker Desktop

## Desenvolvimento

```bash
cp .env.example .env
docker compose up -d postgres localstack
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev:api
```

- O `pnpm install` também gera o Prisma Client e compila o `@4frames/shared` (script `postinstall`).
- Um único `.env` na raiz serve todos os pacotes. Para rodar a API no host, use `DB_HOST=localhost`.
- Os apps consomem o `@4frames/shared` compilado (`dist`). Depois de alterar o `shared`, rode
  `pnpm --filter @4frames/shared build`, ou deixe `pnpm dev:shared` recompilando em outro terminal.

### Comandos (na raiz)

| Comando | O que faz |
|---|---|
| `pnpm dev:api` / `dev:worker` / `dev:notifier` | Compila o `shared` e sobe o app com hot reload |
| `pnpm dev:shared` | Recompila o `shared` a cada mudança |
| `pnpm build` | Compila todos os pacotes, na ordem de dependência |
| `pnpm type-check` | Type-check de todos os pacotes |
| `pnpm lint` / `pnpm lint:fix` | ESLint no monorepo inteiro |
| `pnpm test` | Testes de todos os pacotes |
| `pnpm db:generate` / `db:migrate` / `db:deploy` / `db:seed` | Prisma no `@4frames/shared` |

Para um pacote só, use `--filter`, por exemplo `pnpm --filter @4frames/api test`.

## LocalStack (S3)

Uploads de vídeo usam URLs pré-assinadas do S3 (ver ADR-001). Em desenvolvimento local, o S3 é simulado com [LocalStack](https://www.localstack.cloud/).

O bucket `4frames-videos` (nome configurável via `S3_BUCKET_NAME`) é criado automaticamente no bootstrap do container. Para verificar:

```bash
aws --endpoint-url=http://localhost:4566 s3 ls
```

## Docker

As imagens são construídas a partir da raiz do monorepo.

```bash
docker build -f apps/api/Dockerfile -t 4frames-api .
```

O serviço `node` do `docker-compose.yml` sobe a API em modo desenvolvimento dentro do container
(install, Prisma, migrations, seed e hot reload).

## Endpoints

- `POST /auth` — autenticação por email e senha
- `POST /videos` — cria um job de conversão (`UPLOAD_PENDING`) e devolve uma URL pré-assinada de upload ao S3
- `POST /videos/:jobId/complete` — confirma o upload no S3 (HEAD do objeto) e avança o job para `QUEUED`
- `GET /videos/:jobId` — consulta status do job (autorizado apenas para o dono)
- `GET /health-check` — health check
- `GET /api-docs` — documentação OpenAPI

Todas as rotas de `/videos` exigem `Authorization: Bearer <token>`. O `jobId` é um UUID; um valor em outro formato recebe `400`.

### Fluxo de conversão

1. `POST /videos` com `{ fileName, fileSize, contentType }` (`video/mp4` ou `video/quicktime`, até 500MB) → devolve `{ jobId, uploadUrl, expiresIn }`, com `jobId` em UUID.
2. O cliente faz `PUT` do arquivo direto na `uploadUrl` (bytes não passam pela API).
3. `POST /videos/{jobId}/complete` → confirma o objeto no bucket e marca `QUEUED`.
4. `GET /videos/{jobId}` → consulta o status a qualquer momento (`UPLOAD_PENDING` → `QUEUED` → `PROCESSING` → `DONE`/`FAILED`/`EXPIRED`).

**Ainda não implementado** (ver ADR-001, seção 2.2): o processamento de fato do vídeo
(worker consumindo SQS, ffmpeg extraindo frames, geração do `.zip`), a listagem de jobs
do usuário (`GET /videos`) e o download do resultado
(`GET /videos/{jobId}/download`). Hoje um job fica parado em `QUEUED` após a
confirmação do upload.

## Seeds

Usuários de teste (senha: `123456`):

| Email |
|-------|
| admin@admin.com |
| user@user.com |
