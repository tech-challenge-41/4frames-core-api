# 4frames-core-api

Monorepo do backend do 4Frames: conversão de vídeo em frames (`.zip`) com upload direto ao S3 via URL
pré-assinada, fila para processamento assíncrono e notificação por e-mail.

O front fica em [`4frames-web-app`](https://github.com/tech-challenge-41/4frames-web-app). Regras de
branch, commit e PR estão no [CONTRIBUTING.md](./CONTRIBUTING.md). Convenções de código estão no
[CLAUDE.md](./CLAUDE.md).

## Documentação

[Decisões de arquitetura](./docs/adr/README.md): o [ADR-001](./docs/adr/ADR-001-arquitetura.pdf) define a
arquitetura, e o [ADR-002](./docs/adr/ADR-002-execucao-local-e-monorepo.md) registra a execução local, o monorepo e o
que mudou em relação ao ADR-001.

## Estrutura

| Pacote            | Nome                | O que é                                                                                          |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/api`        | `@4frames/api`      | API REST (Express 5): login JWT, jobs de vídeo e URLs pré-assinadas                              |
| `apps/worker`     | `@4frames/worker`   | Worker: consome a fila SQS, extrai os frames com ffmpeg, gera o zip e publica o progresso        |
| `apps/notifier`   | `@4frames/notifier` | Assina `jobs.events`, envia e-mail (Pug + SMTP/Mailpit) e recupera jobs sem `notified_at`        |
| `packages/shared` | `@4frames/shared`   | Prisma (schema, migrations, seeds e client), env, logger, contratos de job, clientes AWS e Redis |
| `infra/`          | –                   | Scripts de init do LocalStack                                                                    |

A API segue arquitetura hexagonal em `apps/api/src`: `domain` (ports e erros), `application`
(use cases e DTOs), `infra` (HTTP, serviços, logging) e `dependencies` (container de DI).

## Pré-requisitos

- Node.js 24 (ver `.nvmrc`) e pnpm 10
- Docker Desktop

## Desenvolvimento

Um único `.env` na raiz serve os dois modos abaixo, sem edição:

```bash
cp .env.example .env
```

### Tudo no Docker

```bash
docker compose up -d --build
```

Sobe Postgres, Redis, Mailpit, LocalStack, o serviço `migrate` (migrations e seed, depois encerra), a
API em modo desenvolvimento em `http://localhost:3000` e o worker (por padrão **2 consumidores SQS** em paralelo via
`WORKER_CONCURRENCY`; use `docker compose up --scale worker=N` para mais réplicas).

### Apps no host

```bash
docker compose up -d postgres redis mailpit localstack
pnpm install
pnpm db:deploy
pnpm db:seed
pnpm dev:api
```

- O `pnpm install` também gera o Prisma Client e compila o `@4frames/shared` (script `postinstall`).
- Os apps consomem o `@4frames/shared` compilado (`dist`). Depois de alterar o `shared`, rode
  `pnpm --filter @4frames/shared build`, ou deixe `pnpm dev:shared` recompilando em outro terminal.
- Não rode a API nos dois modos ao mesmo tempo: os dois usam a porta 3000. Para trocar, use
  `docker compose stop api`.

### Serviços locais

| Serviço    | Endereço                                               | Para quê                   |
| ---------- | ------------------------------------------------------ | -------------------------- |
| API        | http://localhost:3000 (`/api-docs`)                    | REST                       |
| PostgreSQL | localhost:5432                                         | Banco                      |
| LocalStack | http://localhost:4566                                  | S3 e SQS                   |
| Redis      | localhost:6379                                         | Progresso e eventos de job |
| Mailpit    | SMTP em localhost:1025, caixa em http://localhost:8025 | E-mails de desenvolvimento |

### Comandos (na raiz)

| Comando                                                     | O que faz                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev:api` / `dev:worker` / `dev:notifier`              | Compila o `shared` e sobe o app com hot reload                         |
| `pnpm dev:shared`                                           | Recompila o `shared` a cada mudança                                    |
| `pnpm build`                                                | Compila todos os pacotes, na ordem de dependência                      |
| `pnpm type-check`                                           | Type-check de todos os pacotes                                         |
| `pnpm lint` / `pnpm lint:fix`                               | ESLint no monorepo inteiro                                             |
| `pnpm format` / `pnpm format:check`                         | Prettier em Markdown, JSON e YAML (TypeScript é formatado pelo ESLint) |
| `pnpm test`                                                 | Testes de todos os pacotes                                             |
| `pnpm db:generate` / `db:migrate` / `db:deploy` / `db:seed` | Prisma no `@4frames/shared`                                            |

Para um pacote só, use `--filter`, por exemplo `pnpm --filter @4frames/api test`.

## LocalStack (S3 e SQS)

Em desenvolvimento, S3 e SQS são simulados com [LocalStack](https://www.localstack.cloud/). A cada start
do container, os scripts de `infra/localstack/init/` criam:

| Script                  | Recurso                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `00-s3.sh`              | Bucket `4frames-videos` com CORS para o PUT direto do navegador                                                          |
| `10-sqs.sh`             | Fila `4frames-video-uploads` (visibility 600 s, long polling 20 s) e DLQ `4frames-video-uploads-dlq` após 3 recebimentos |
| `20-s3-notification.sh` | Notificação `s3:ObjectCreated:*` do prefixo `videos/` para a fila                                                        |

Todo upload confirmado gera uma mensagem na fila com a chave `videos/{userId}/{jobId}/source.{ext}`.
Gravações em `frames/` e `zips/` não geram mensagens. Para inspecionar:

```bash
aws --endpoint-url=http://localhost:4566 sqs receive-message --queue-url http://localhost:4566/000000000000/4frames-video-uploads
```

- Ao configurar a notificação, o S3 publica um `s3:TestEvent` na fila. Isso acontece a cada start do
  LocalStack, e o consumidor da fila deve ignorar esse evento.
- O LocalStack roda sem persistência: reiniciar o container apaga objetos e mensagens, e os scripts
  recriam bucket, filas e notificação vazios.
- A API assina as URLs de upload com `S3_PUBLIC_ENDPOINT_URL` (o endereço que o navegador alcança) e
  fala com o S3 por `AWS_ENDPOINT_URL`, que dentro do Compose é `http://localstack:4566`.

## Docker

O `docker-compose.yml` usa a imagem de desenvolvimento (`apps/api/dev.Dockerfile`) nos serviços `migrate`
e `api`, e `apps/worker/dev.Dockerfile` (a mesma base, com ffmpeg) no `worker`. O entrypoint instala as
dependências, gera o Prisma Client, compila o `@4frames/shared` e executa o comando do serviço. `api` e
`worker` sobem juntos depois do `migrate`; o worker pula a geração e a compilação (`SKIP_SHARED_BUILD=1`)
para os dois não reescreverem os mesmos arquivos ao mesmo tempo.

As imagens de produção são construídas a partir da raiz do monorepo:

```bash
docker build -f apps/api/Dockerfile -t 4frames-api .
docker build -f apps/worker/Dockerfile -t 4frames-worker .
```

A imagem do worker instala `ffmpeg` (como o projeto base), roda como usuário `node` e expõe a porta `9100`
(`/healthz`).

## Endpoints

- `POST /auth` — autenticação por email e senha
- `POST /videos` — cria um job de conversão (`UPLOAD_PENDING`) e devolve uma URL pré-assinada de upload ao S3
- `GET /videos` — lista os jobs do usuário autenticado, paginado (`limit`/`offset`), mais recentes primeiro
- `GET /videos/:jobId` — consulta status do job (autorizado apenas para o dono)
- `GET /videos/:jobId/events` — progresso em tempo real via SSE (Server-Sent Events), alimentado pelo Redis Pub/Sub que o worker publica
- `POST /videos/:jobId/complete` — confirma o upload no S3 (HEAD do objeto) e avança o job para `QUEUED`
- `POST /videos/:jobId/cancel` — cancela um job em `UPLOAD_PENDING` ou `QUEUED` (reaproveita o status `EXPIRED`)
- `GET /videos/:jobId/download` — URL pré-assinada de download do `.zip` (só quando o job está `DONE`)
- `GET /health-check` — health check
- `GET /api-docs` — documentação OpenAPI

Todas as rotas de `/videos` exigem `Authorization: Bearer <token>`, exceto `GET /videos/:jobId/events`,
que aceita o token via `?token=` (o `EventSource` do navegador não permite headers customizados — ver
[CLAUDE.md](./CLAUDE.md), seção "Real-time progress"). O `jobId` é um UUID; um valor em outro formato
recebe `400`.

### Fluxo de conversão

1. `POST /videos` com `{ fileName, fileSize, contentType }` (`video/mp4` ou `video/quicktime`, até 500MB) → devolve `{ jobId, uploadUrl, expiresIn }`, com `jobId` em UUID.
2. O cliente faz `PUT` do arquivo direto na `uploadUrl` (bytes não passam pela API).
3. `POST /videos/{jobId}/complete` → confirma o objeto no bucket e marca `QUEUED`. Até esse ponto o job
   ainda pode ser cancelado com `POST /videos/{jobId}/cancel`.
4. `GET /videos/{jobId}` (polling) ou `GET /videos/{jobId}/events` (SSE, progresso ao vivo durante
   `PROCESSING`) → acompanha o status: `UPLOAD_PENDING` → `QUEUED` → `PROCESSING` → `DONE`/`FAILED`/`EXPIRED`.
5. Quando `DONE`, `GET /videos/{jobId}/download` devolve uma URL pré-assinada de `GET` para o `.zip`.

O processamento em si é feito pelo worker (ver [Worker](#worker)). **Ainda não implementado**: o
`apps/notifier` (envio de e-mail em `job.done`/`job.failed`), e toda a camada de infraestrutura do
ADR-002 (Kubernetes local, CI/CD, observabilidade) — ver "Known gaps" no [CLAUDE.md](./CLAUDE.md).

## Worker

O `apps/worker` consome a fila `4frames-video-uploads`, uma mensagem por vez, e processa cada vídeo com a
mesma regra do projeto base: `ffmpeg -vf fps=1`, um PNG por segundo (`frame_0001.png`, `frame_0002.png`…),
todos na raiz do zip.

1. Ignora o `s3:TestEvent`, lê `userId` e `jobId` da chave e descarta jobs já `DONE`, `FAILED` ou `EXPIRED`.
   Se o upload ainda não foi confirmado (`UPLOAD_PENDING`), espera o `complete` por até 30 s e, se não vier,
   devolve a mensagem à fila.
2. Marca `PROCESSING` com atualização condicional (entrega duplicada não processa duas vezes), baixa o vídeo,
   valida com ffprobe (MP4/MOV, trilha de vídeo, até `MAX_VIDEO_DURATION_SECONDS`) e extrai os frames.
3. Grava `frames/{userId}/{jobId}/…` e `zips/{userId}/{jobId}.zip` no S3, depois `DONE` no banco
   (`zip_key`, `frame_count`, `duration_seconds`) e só então publica `job.done` no Redis.

- **Progresso**: `job:{jobId}` (Pub/Sub) e `progress:{jobId}` (percentual, TTL de 1 h), no máximo uma
  publicação por ponto percentual e por segundo. Eventos terminais também saem em `jobs.events`.
- **Vídeo inválido**: `FAILED` com `failure_reason` legível, `job.failed` e a mensagem é apagada.
- **Falha transiente** (S3, banco, ffmpeg morto): a mensagem volta à fila em 60 s. Depois de 3 recebimentos
  vai para a DLQ, e o próprio worker marca o job `FAILED` com `Falha após 3 tentativas`.
- **Visibilidade**: enquanto processa, o worker renova a visibilidade da mensagem a cada
  `VISIBILITY_TIMEOUT_SECONDS / 2`. Se o worker cair, a mensagem reaparece e outro worker retoma o job.
- **Encerramento**: no SIGTERM (`docker compose stop worker`, scale-down do KEDA) para de receber, termina o
  job atual e sai, dentro de `WORKER_SHUTDOWN_TIMEOUT_SECONDS`.
- **Saúde**: `GET http://localhost:9100/healthz` responde 200 enquanto o laço de consumo está vivo, e 503
  quando parou ou ficou mais de 60 s sem sinal.

No Compose, o worker roda compilado, sem hot reload: o `ts-node-dev` sai ao receber SIGTERM sem esperar o
processo filho, o que impediria o encerramento gracioso. Depois de mudar o código, rode
`docker compose restart worker`. `pnpm dev:worker` no host também funciona, mas exige `ffmpeg` e `ffprobe` no
PATH.

Os testes com vídeo de amostra (`apps/worker/test/integration`) são pulados quando não há ffmpeg no PATH.
Para rodá-los no container:

```bash
docker compose exec worker pnpm --filter @4frames/worker test
```

## Seeds

Usuários de teste (senha: `123456`):

| Email           |
| --------------- |
| admin@admin.com |
| user@user.com   |
