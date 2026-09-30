# 4frames-core-api

Monorepo do backend do 4Frames: conversão de vídeo em frames (`.zip`) com upload direto ao S3 via URL
pré-assinada, fila para processamento assíncrono e notificação por e-mail.

O front fica em [`4frames-web-app`](https://github.com/tech-challenge-41/4frames-web-app). Regras de
branch, commit e PR estão no [CONTRIBUTING.md](./CONTRIBUTING.md). Convenções de código estão no
[CLAUDE.md](./CLAUDE.md).

## Como rodar a solução completa

Um comando sobe tudo num cluster Kubernetes local (Kind):

- o front e a API atrás do Ingress, com a API escalada pelo HPA;
- o worker escalado pelo KEDA pela profundidade da fila SQS;
- o notifier;
- opcionalmente, com uma conta no Datadog, o Datadog Agent, que recebe traces, logs e métricas dos três apps.

Postgres, Redis, LocalStack (S3 e SQS) e Mailpit rodam no Docker Compose, fora do cluster, como os serviços gerenciados ficavam fora do EKS no ADR-001.

**Pré-requisitos**

- Docker com Compose v2 e 8 GB de memória ou mais para ele. Em repouso a stack usa cerca de 2,5 GB; no pico, cada worker processa um vídeo com ffmpeg.
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation), [kubectl](https://kubernetes.io/docs/tasks/tools/), `curl` e Git. No Windows, rode os comandos no Git Bash.
- Só para a telemetria, que é opcional: uma conta no Datadog (site `us5.datadoghq.com`) com a API key em `DD_API_KEY` no `.env`, [helm](https://helm.sh/docs/intro/install/) e `envsubst` (o Git Bash já traz). O Agent pede mais 512 MiB (até 1,25 GiB), fora o Cluster Agent e o kube-state-metrics. Ver [DATADOG_README.md](./DATADOG_README.md).
- Portas livres no host: 8080 e 8443 (Ingress), 5432, 6379, 4566, 1025 e 8025.

Node e pnpm não são necessários: as imagens são construídas dentro do Docker.

```bash
git clone https://github.com/tech-challenge-41/4frames-core-api.git
git clone https://github.com/tech-challenge-41/4frames-web-app.git
cd 4frames-core-api
cp .env.example .env   # opcional: preencha DD_API_KEY para ligar o Datadog
./scripts/k8s-local.sh up
```

O front é construído a partir do `4frames-web-app` clonado ao lado. Se não houver `.env`, o `up` cria um a partir do `.env.example`, que vem sem a `DD_API_KEY` e, portanto, sem telemetria. Depois ele segue estas etapas, esperando cada uma ficar pronta:

1. Infra no Compose: Postgres, Redis, Mailpit e LocalStack com bucket, filas e DLQ.
2. Cluster Kind `4frames-local`, com o Ingress publicado em 8080 e 8443.
3. Build das imagens `api`, `worker`, `notifier`, `web` e `migrate`, carregadas no nó.
4. metrics-server, para o HPA medir a CPU da API.
5. ingress-nginx.
6. KEDA.
7. Com `DD_API_KEY` no `.env`, o Datadog Agent pelo Helm, no namespace `datadog`, e o OpenTelemetry ligado nos apps. Sem ela, a etapa é pulada.
8. Migrations e seed num Job e, depois, os apps.
9. Verificação pelo Ingress: o front em `/` e a API em `/api/ready`, que só responde 200 com banco e Redis de pé.

A primeira execução baixa as imagens base e constrói tudo, por isso demora mais. As seguintes aproveitam o cache. Rodar o `up` de novo com a stack no ar atualiza o que mudou.

| O quê                   | Onde                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Front                   | http://localhost:8080, com o usuário do seed `admin@admin.com` / `123456`                                                 |
| API                     | http://localhost:8080/api, com o Swagger em http://localhost:8080/api/api-docs/                                           |
| E-mails                 | Mailpit, http://localhost:8025                                                                                            |
| S3 e SQS                | LocalStack, http://localhost:4566                                                                                         |
| Traces, logs e métricas | Com `DD_API_KEY`: Datadog, https://app.us5.datadoghq.com (APM, Logs, Infrastructure → Kubernetes e o dashboard "4Frames") |

```bash
./scripts/k8s-local.sh status       # pods, Ingress, HPA, ScaledObject e, se houver, os pods do Datadog Agent
./scripts/k8s-local.sh logs         # últimas linhas do Agent e de cada app
./scripts/k8s-local.sh down         # apaga o cluster; a infra do Compose continua
./scripts/k8s-local.sh down --all   # apaga o cluster e derruba a infra do Compose
```

O `down --all` mantém o volume do Postgres. Para apagar também os dados, rode `docker compose down -v` depois. Depois de reiniciar a máquina ou o Docker Desktop, rode `down` e `up`: o nó do Kind volta sem as portas publicadas.

### Ajustar as réplicas

| App    | Quem escala         | Arquivo                                   | Campos (padrão)                                                                      |
| ------ | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| API    | HPA, pela CPU       | `infra/k8s/base/api-hpa.yaml`             | `minReplicas` (2), `maxReplicas` (4), `averageUtilization` (70 % do `requests.cpu`)  |
| Worker | KEDA, pela fila SQS | `infra/k8s/base/worker-scaledobject.yaml` | `minReplicaCount` (1), `maxReplicaCount` (5), `queueLength` (1 mensagem por réplica) |

Para mudar de vez, edite o arquivo e rode `./scripts/k8s-local.sh up`. Para experimentar sem editar, mude direto no cluster. O próximo `up` volta aos valores dos arquivos.

```bash
kubectl -n 4frames patch hpa api --type merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
kubectl -n 4frames patch scaledobject worker --type merge -p '{"spec":{"minReplicaCount":0,"maxReplicaCount":8}}'
kubectl -n 4frames get hpa,scaledobject
```

- Cada worker processa um vídeo por vez (`WORKER_MAX_PARALLEL_JOBS=1` no ConfigMap), então o máximo de réplicas é o máximo de vídeos em paralelo. Numa máquina só, réplicas além do número de núcleos não aceleram nada.
- Com `minReplicaCount: 0`, o KEDA desliga o worker quando a fila esvazia, e o primeiro vídeo seguinte espera um pod subir.
- O HPA depende do metrics-server, cuja primeira coleta leva perto de um minuto.

Detalhes dos manifestos, do script e do CD: [infra/k8s/README.md](./infra/k8s/README.md).

## Documentação

[Decisões de arquitetura](./docs/adr/README.md):

| ADR                                                                    | Assunto                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [ADR-001](./docs/adr/ADR-001-arquitetura.pdf)                          | A arquitetura: três planos, fluxo ponta a ponta e garantias                            |
| [ADR-002](./docs/adr/ADR-002-execucao-local-e-monorepo.md)             | Execução sem AWS, monorepo e job com UUID, com o que substitui cada serviço gerenciado |
| [ADR-003](./docs/adr/ADR-003-cluster-local-kind-compose-kustomize.md)  | Cluster Kind, infraestrutura no Compose, Kustomize, Ingress, migrations e expiração    |
| [ADR-004](./docs/adr/ADR-004-escala-e-encerramento-sem-perda.md)       | HPA, KEDA e encerramento gracioso de API e worker                                      |
| [ADR-005](./docs/adr/ADR-005-ciclo-de-vida-do-job.md)                  | Estados do job, cancelamento, expiração, falhas, progresso e notificação               |
| [ADR-006](./docs/adr/ADR-006-autenticacao-e-acesso.md)                 | Login, token, autorização por dono, URLs pré-assinadas e segredos                      |
| [ADR-007](./docs/adr/ADR-007-qualidade-testes-e-entrega.md)            | Camadas de teste, gates de cobertura, evidências, CI/CD e fluxo de trabalho            |
| [ADR-008](./docs/adr/ADR-008-observabilidade-opentelemetry-datadog.md) | OpenTelemetry nos apps, Datadog Agent opcional, métricas, dashboard e monitores        |

Além dos ADRs: o [README do Kubernetes](./infra/k8s/README.md) (manifestos, script e CD), o
[README do Datadog](./DATADOG_README.md) (como ligar, variáveis, métricas, dashboard e monitores), as
[evidências de carga e escala](./docs/evidence/README.md) e o OpenAPI, servido pela API em `/api-docs`.

### Scripts de criação dos recursos

| Recurso               | Scripts                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banco (PostgreSQL)    | Migrations em SQL, aplicadas em ordem por `prisma migrate deploy`: [`packages/shared/prisma/migrations/*/migration.sql`](./packages/shared/prisma/migrations). Usuários de teste: [`packages/shared/prisma/seeds`](./packages/shared/prisma/seeds) |
| S3 e SQS (LocalStack) | [`infra/localstack/init`](./infra/localstack/init): bucket com CORS, fila com DLQ e a notificação `videos/` → fila                                                                                                                                 |
| Infraestrutura local  | [`docker-compose.yml`](./docker-compose.yml): Postgres, Redis, LocalStack, Mailpit e o Datadog Agent (opcional)                                                                                                                                    |
| Cluster e aplicação   | [`scripts/k8s-local.sh`](./scripts/k8s-local.sh) e os manifestos em [`infra/k8s`](./infra/k8s), com o Job que aplica migrations e seed no cluster                                                                                                  |
| Datadog Agent no Kind | Chart `datadog/datadog` pelo Helm, com os valores de [`infra/k8s/datadog-values.yaml`](./infra/k8s/datadog-values.yaml), instalado pelo `k8s-local.sh` com `DD_API_KEY`                                                                            |
| Dashboard e monitores | [`infra/datadog`](./infra/datadog), aplicados no Datadog por [`scripts/datadog-apply.mjs`](./scripts/datadog-apply.mjs)                                                                                                                            |

## Estrutura

| Pacote            | Nome                | O que é                                                                                                                                                                                    |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`        | `@4frames/api`      | API REST (Express 5): login JWT, jobs de vídeo e URLs pré-assinadas                                                                                                                        |
| `apps/worker`     | `@4frames/worker`   | Worker: consome a fila SQS, extrai os frames com ffmpeg, gera o zip e publica o progresso                                                                                                  |
| `apps/notifier`   | `@4frames/notifier` | Assina `jobs.events`, envia e-mail (Pug + SMTP/Mailpit) e recupera jobs sem `notified_at`                                                                                                  |
| `packages/shared` | `@4frames/shared`   | Prisma (schema, migrations, seeds e client), env, logger, contratos de job, clientes AWS e Redis, OpenTelemetry e métricas (`monitoring`)                                                  |
| `infra/`          | –                   | LocalStack (`localstack/init`), manifestos Kubernetes com Kustomize (`k8s/`), os valores do Datadog Agent (`k8s/datadog-values.yaml`) e o dashboard e os monitores do Datadog (`datadog/`) |
| `scripts/`        | –                   | `k8s-local.sh`: cluster Kind local com a stack completa                                                                                                                                    |
| `tests/e2e`       | `@4frames/e2e`      | Teste ponta a ponta contra a stack no cluster (`pnpm test:e2e`)                                                                                                                            |
| `tests/load`      | –                   | Cenários de carga com o k6 e a escala do worker pelo KEDA, com evidência em `docs/evidence/`                                                                                               |

A API segue arquitetura hexagonal em `apps/api/src`: `domain` (ports e erros), `application`
(use cases e DTOs), `infra` (HTTP, serviços, logging) e `dependencies` (container de DI).

## Pré-requisitos

- Node.js 24 (ver `.nvmrc`) e pnpm 10
- Docker
- Para o cluster local: [kind](https://kind.sigs.k8s.io/) e `kubectl`
- Para a telemetria, opcional: `DD_API_KEY` no `.env` e, no cluster, `helm` e `envsubst` (ver [DATADOG_README.md](./DATADOG_README.md))

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
API em modo desenvolvimento em `http://localhost:3000`, o **worker** (por padrão **2 vídeos em paralelo** no mesmo
processo via `WORKER_MAX_PARALLEL_JOBS`; use `docker compose up --scale worker=N` para mais réplicas) e o **notifier** (e-mail em
`job.done`/`job.failed` pelo SMTP do Mailpit, com a caixa em http://localhost:8025). Com `DD_API_KEY`, `OTEL_ENABLED=true`
e `COMPOSE_PROFILES=datadog` no `.env`, sobe também o **Datadog Agent** (`datadog-agent`), para onde os três apps mandam
traces, logs e métricas (ver [DATADOG_README.md](./DATADOG_README.md)).

Para recriar só o notificador após mudanças no código: `docker compose up -d --build notifier`.

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
- O `.env.example` deixa o OpenTelemetry desligado. Para ligar, ponha `DD_API_KEY` e `OTEL_ENABLED=true` no `.env` e
  acrescente `datadog-agent` ao `docker compose up`. O `.env` traz `OTEL_SERVICE_NAME=4frames-api`; para o worker e o
  notifier, troque o nome no comando (`OTEL_SERVICE_NAME=4frames-worker pnpm dev:worker`).

### Cluster Kubernetes local (Kind)

É a [solução completa](#como-rodar-a-solução-completa), com `./scripts/k8s-local.sh up`. No desenvolvimento:

- Pare antes `api`, `worker` e `notifier` do Compose, que disputariam a mesma fila com o cluster:
  `docker compose stop api worker notifier`. O `up` avisa quando eles estão no ar.
- Código novo entra no cluster com outro `up`: ele reconstrói as imagens e reinicia só os Deployments cuja
  imagem mudou.
- Para o front em modo dev contra a API do cluster, no `4frames-web-app`:
  `VITE_API_URL=http://localhost:8080/api pnpm dev` → http://localhost:5173.
- `kubectl -n 4frames get pods -l app.kubernetes.io/name=worker -w` mostra o KEDA subindo workers enquanto
  vídeos entram na fila.

Layout dos manifestos, o que o script faz passo a passo e o deploy de uma tag `release-*`:
[infra/k8s/README.md](./infra/k8s/README.md).

### Serviços locais

| Serviço       | Endereço                                                                                  | Para quê                                         |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| API           | http://localhost:3000 (`/api-docs`)                                                       | REST (Compose ou `pnpm dev:api`)                 |
| API no Kind   | http://localhost:8080/api (`/api/api-docs/`), pelo Ingress                                | REST no cluster local                            |
| PostgreSQL    | localhost:5432                                                                            | Banco                                            |
| LocalStack    | http://localhost:4566                                                                     | S3 e SQS                                         |
| Redis         | localhost:6379                                                                            | Progresso e eventos de job                       |
| Mailpit       | SMTP em localhost:1025 (`mailpit:1025` no Compose), caixa em http://localhost:8025        | E-mails de desenvolvimento (substitui o SES)     |
| Notifier      | `GET /healthz` na porta 9100; logs via `docker compose logs -f notifier`                  | E-mail ao terminar/falhar job                    |
| Datadog Agent | OTLP HTTP em localhost:4318 (`datadog-agent:4318` no Compose), só com o profile `datadog` | Traces, logs e métricas dos apps rumo ao Datadog |

### Comandos (na raiz)

| Comando                                                     | O que faz                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev:api` / `dev:worker` / `dev:notifier`              | Compila o `shared` e sobe o app com hot reload                                |
| `pnpm dev:shared`                                           | Recompila o `shared` a cada mudança                                           |
| `pnpm build`                                                | Compila todos os pacotes, na ordem de dependência                             |
| `pnpm type-check`                                           | Type-check de todos os pacotes                                                |
| `pnpm lint` / `pnpm lint:fix`                               | ESLint no monorepo inteiro                                                    |
| `pnpm format` / `pnpm format:check`                         | Prettier em Markdown, JSON e YAML (TypeScript é formatado pelo ESLint)        |
| `pnpm test`                                                 | Testes de todos os pacotes                                                    |
| `pnpm test:e2e`                                             | Teste ponta a ponta contra a stack no cluster (precisa do `k8s-local.sh up`)  |
| `pnpm db:generate` / `db:migrate` / `db:deploy` / `db:seed` | Prisma no `@4frames/shared`                                                   |
| `pnpm --filter @4frames/api expire --once`                  | Uma passada da expiração de uploads abandonados (sem `--once`, a cada minuto) |

Para um pacote só, use `--filter`, por exemplo `pnpm --filter @4frames/api test`.

### Expiração de uploads abandonados

Um job criado com `POST /videos` cujo upload nunca foi confirmado fica em `UPLOAD_PENDING`. Quando a URL
de upload vence (`UPLOAD_URL_TTL_SECONDS`, 5 min) e passa mais 60 s de folga, a rotina de expiração o marca
como `EXPIRED`. Ela também conta, e registra no log, os jobs em `PROCESSING` sem nenhuma escrita há mais de
15 min, sinal de worker parado.

A rotina é um entrypoint separado na imagem da API (`dist/cron/main.js`), fora das réplicas dela, e roda uma
execução por vez:

- No cluster, é o CronJob `expire-uploads`, a cada minuto, com `concurrencyPolicy: Forbid` e `--once`.
- No desenvolvimento, com os apps no host: `pnpm --filter @4frames/api expire --once` para uma passada, ou
  sem `--once` para uma passada por minuto até o Ctrl+C.
- Com tudo no Docker: `docker compose exec api pnpm --filter @4frames/api expire --once`.

A escrita é condicional (`UPLOAD_PENDING` no `WHERE`): um job que o `complete` levou a `QUEUED` no mesmo
instante não expira, e rodar a rotina duas vezes não muda nada.

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
docker build -f apps/notifier/Dockerfile -t 4frames-notifier .
docker build -f packages/shared/Dockerfile -t 4frames-migrate .   # migrations e seed (Job do cluster)
```

A imagem do worker instala `ffmpeg` (como o projeto base), roda como usuário `node` e expõe a porta `9100`
(`/healthz`).

## Observabilidade

É opcional: sem conta no Datadog, a solução sobe e funciona igual, sem telemetria. Com a conta, API, worker e notifier
usam o OpenTelemetry e mandam traces, logs do pino e métricas pelo OTLP ao Datadog Agent, que repassa ao Datadog (site
`us5`). Cada app aparece no APM com o próprio nome: `4frames-api`, `4frames-worker` e `4frames-notifier`.

| Onde rodam os apps    | Como ligar                                                               | Agent                                                                       |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| No Kind               | `DD_API_KEY` no `.env`                                                   | Instalado pelo `k8s-local.sh` com o Helm, um por nó, no namespace `datadog` |
| No host ou no Compose | `DD_API_KEY`, `OTEL_ENABLED=true` e `COMPOSE_PROFILES=datadog` no `.env` | Serviço `datadog-agent` do Compose, em `localhost:4318`                     |

Além dos traces, os apps mandam métricas do job e da fila: jobs criados, concluídos e com falha (com o motivo), o tempo
de processamento, a profundidade da fila de uploads e da DLQ e os jobs presos em `PROCESSING`. No Kind, o Agent também
mostra pods e réplicas de API e worker. O dashboard "4Frames" e os monitores (DLQ acumulando, jobs presos e falhas
depois de 3 tentativas) estão versionados em [`infra/datadog`](./infra/datadog) e vão para o Datadog com
`node --env-file=.env scripts/datadog-apply.mjs`.

A decisão e os limites estão no [ADR-008](./docs/adr/ADR-008-observabilidade-opentelemetry-datadog.md); como ligar,
variáveis, métricas e onde ver cada coisa, no [DATADOG_README.md](./DATADOG_README.md).

## CI/CD (GitHub Actions)

- **CI** (`.github/workflows/ci.yml`), em toda PR, inclusive as empilhadas sobre outra branch, e em push para
  `develop`/`main`: `test` (com gate de cobertura Jest, sem SonarCloud, e com ffmpeg, para os testes de integração do
  worker) → `lint` → `type-check` → validação dos manifestos Kubernetes → build das imagens `api`, `worker`,
  `notifier` e `migrate`.
- **CD** (`.github/workflows/cd.yml`), em tag `release-*`: publica as imagens versionadas no GHCR, sobe um cluster Kind
  efêmero com o KEDA, aplica `infra/k8s/overlays/ci` e roda smoke (`/health-check`, `/healthz`, rollout do notifier).
  Esse cluster não tem o Datadog Agent, e o OpenTelemetry fica desligado.

Deploy da mesma tag num cluster local, só trocando as tags de imagem: [infra/k8s/README.md](./infra/k8s/README.md).
Regras de merge (CI verde + revisão de outra pessoa, sem branch protection no plano Free): [CONTRIBUTING.md](./CONTRIBUTING.md).

## Endpoints

- `POST /auth/login` — autenticação por email e senha (`POST /auth` continua respondendo igual, marcada como
  _deprecated_ no OpenAPI)
- `POST /videos` — cria um job de conversão (`UPLOAD_PENDING`) e devolve uma URL pré-assinada de upload ao S3
- `GET /videos` — lista os jobs do usuário autenticado, paginado (`limit`/`offset`), mais recentes primeiro,
  com o percentual (`progress`) dos jobs em `PROCESSING`
- `GET /videos/:jobId` — consulta status do job (autorizado apenas para o dono), com o `progress` quando em
  `PROCESSING`
- `GET /videos/:jobId/events` — progresso em tempo real via SSE (Server-Sent Events), alimentado pelo Redis Pub/Sub que o worker publica
- `POST /videos/:jobId/complete` — confirma o upload no S3 (HEAD do objeto) e avança o job para `QUEUED`
- `POST /videos/:jobId/cancel` — cancela um job em `UPLOAD_PENDING` ou `QUEUED` (reaproveita o status `EXPIRED`)
- `GET /videos/:jobId/download` — URL pré-assinada de download do `.zip` (só quando o job está `DONE`)
- `GET /health-check` — o processo está de pé (liveness)
- `GET /ready` — Postgres e Redis respondem: `200` ou `503`, com o estado de cada um (readiness)
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
4. `GET /videos/{jobId}` (polling, com o último percentual em `progress`) ou `GET /videos/{jobId}/events` (SSE,
   progresso ao vivo durante `PROCESSING`) → acompanha o status: `UPLOAD_PENDING` → `QUEUED` → `PROCESSING` →
   `DONE`/`FAILED`/`EXPIRED`. O percentual vem do Redis e é opcional: sem ele, a resposta sai sem o campo.
5. Quando `DONE`, `GET /videos/{jobId}/download` devolve uma URL pré-assinada de `GET` para o `.zip`.

O processamento em si é feito pelo worker (ver [Worker](#worker)), e o `apps/notifier` manda o e-mail em
`job.done`/`job.failed`. Com o Datadog ligado, os três apps mandam traces, logs e métricas a ele (ver
[Observabilidade](#observabilidade)).

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
- **Upload confirmado tarde**: se os 3 recebimentos se esgotam esperando o `complete`, a mensagem chega à DLQ com o
  job em `UPLOAD_PENDING` ou `QUEUED`, nunca tentado. O worker a devolve à fila de uploads como mensagem nova, até 3
  vezes (atributo `requeue-count`), em vez de marcar `FAILED` ou descartar.
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

## Testes ponta a ponta e de carga

Os dois rodam contra a stack no cluster, que precisa estar no ar (`./scripts/k8s-local.sh up`): eles não sobem
nada. Os jobs ficam com o `user@user.com`, e a listagem do `admin@admin.com` não muda.

**Ponta a ponta** (`tests/e2e`, Jest), pelo Ingress, como o navegador:

- login, `POST /videos`, `PUT` direto no S3 e `complete`;
- o progresso chega pelo SSE até o `job.done`, e o status termina em `DONE`;
- o zip tem um PNG por segundo, na ordem e na raiz, e o e-mail chega ao Mailpit com o link do job;
- um arquivo inválido termina em `FAILED`, com o motivo, e gera o e-mail de falha;
- a listagem mostra os dois, e outro usuário recebe 404, como para um job que não existe.

```bash
pnpm test:e2e
```

`API_URL` e `MAILPIT_URL` apontam para outro ambiente; o padrão é `http://localhost:8080/api` e
`http://localhost:8025`.

**Carga e escala** (`tests/load`, com o k6 no container `grafana/k6`, sem instalar nada). O `run-scenario.sh`:

- envia `VIDEOS` vídeos ao mesmo tempo (padrão 10), como pelo front (`uploads.js`);
- mantém `USERS` usuários consultando a listagem a cada 3 s durante o pico (padrão 10, `listagem.js`);
- grava em `docs/evidence/<cenário>/` a evolução dos workers, da fila e dos jobs, com um gráfico (`timeline.svg`) e um
  resumo (`resumo.md`);
- sai com erro se alguma requisição falhar ou se algum vídeo não chegar a `DONE`.

```bash
tests/load/run-scenario.sh 1-worker 1                            # o KEDA limitado a 1: um worker fixo
tests/load/run-scenario.sh keda-ate-5 5                          # o KEDA de 1 a 5 workers
tests/load/run-scenario.sh reducao-no-meio 5 --reduzir-no-meio   # o máximo cai para 1 com 5 vídeos em processamento
```

No Windows, rode no Git Bash. Os resultados e a comparação estão em [docs/evidence](./docs/evidence/README.md).

## Seeds

Usuários de teste (senha: `123456`):

| Email           |
| --------------- |
| admin@admin.com |
| user@user.com   |
