# 4frames-core-api

API REST do núcleo 4Frames — autenticação de funcionários via JWT e criação/acompanhamento
de jobs de conversão de vídeo em frames (`.zip`), com upload direto ao S3 via URL
pré-assinada (ver ADR-001 na raiz do monorepo).

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
- `POST /videos` — cria um job de conversão (`UPLOAD_PENDING`) e devolve uma URL pré-assinada de upload ao S3
- `POST /videos/:jobId/complete` — confirma o upload no S3 (HEAD do objeto) e avança o job para `QUEUED`
- `GET /videos/:jobId` — consulta status do job (autorizado apenas para o dono)
- `GET /health-check` — health check
- `GET /api-docs` — documentação OpenAPI

Todas as rotas de `/videos` exigem `Authorization: Bearer <token>`.

### Fluxo de conversão

1. `POST /videos` com `{ fileName, fileSize, contentType }` (`video/mp4` ou `video/quicktime`, até 500MB) → devolve `{ jobId, uploadUrl, expiresIn }`.
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
