# Datadog — desenvolvimento local (4Frames)

Mesmo padrão do **garagio-api**: OpenTelemetry nos apps → OTLP HTTP → **Datadog Agent** → site `us5`. A decisão e
os trade-offs estão no [ADR-008](./docs/adr/ADR-008-observabilidade-opentelemetry-datadog.md).

**É opcional.** Sem conta no Datadog, o `.env.example` já deixa tudo desligado, e a solução sobe e funciona igual, só
sem telemetria.

## Como ligar

Precisa de uma conta no Datadog, no site `us5.datadoghq.com`, e da API key dela.

| Onde                                    | No `.env`                                                      | Além disso                                        |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Cluster Kind (`./scripts/k8s-local.sh`) | `DD_API_KEY`                                                   | `helm` e `envsubst` no PATH                       |
| `docker compose up`                     | `DD_API_KEY`, `OTEL_ENABLED=true` e `COMPOSE_PROFILES=datadog` | —                                                 |
| Apps no host (`pnpm dev:*`)             | `DD_API_KEY` e `OTEL_ENABLED=true`                             | Suba o `datadog-agent` junto com a infra (abaixo) |

O Git Bash do Windows já traz o `envsubst`; o `helm` precisa ser instalado. No cluster, o `up` confere as duas
ferramentas só quando há `DD_API_KEY`, antes de subir qualquer coisa.

## Stack

| Modo                                  | Agent                                                                   | Como os apps chegam ao Agent                                  |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| Apps no host (`pnpm dev:*`)           | serviço `datadog-agent` do Compose (profile `datadog`), OTLP em `:4318` | `DD_AGENT_HOST=localhost` (`.env`)                            |
| `docker compose up` (apps no Compose) | o mesmo serviço                                                         | `DD_AGENT_HOST=datadog-agent` (`x-container-endpoints`)       |
| `./scripts/k8s-local.sh up` (Kind)    | **Helm**: DaemonSet no namespace `datadog`, OTLP na porta 4318 do nó    | `DD_AGENT_HOST=status.hostIP` em cada Deployment e no CronJob |

- No Compose, o `datadog-agent` só sobe com o profile `datadog`, e a dependência dos apps nele é opcional
  (`required: false`). Quem liga o OTel dos apps é o `OTEL_ENABLED` do `.env`.
- No Kind, o Agent do Compose não é usado: o `k8s-local.sh` sobe no Compose só Postgres, Redis, Mailpit e LocalStack e,
  com `DD_API_KEY`, instala o chart `datadog/datadog` com os valores de
  [`infra/k8s/datadog-values.yaml`](./infra/k8s/datadog-values.yaml) (Agent, Cluster Agent e kube-state-metrics). A
  chave vai para o Secret `datadog-agent-secret`, no namespace `datadog`.
- Sem `DD_API_KEY`, o `up` pula o Agent e aplica o overlay `local` com `OTEL_ENABLED` em `false`. Com ela, o overlay liga
  o OTel e põe `DD_ENV`/`APP_ENV` em `development`. O `base` deixa o OTel desligado, e o CD (overlay `ci`) roda sem
  Agent.

```bash
# Infra com o Agent, para os apps no host: nomear o serviço o sobe mesmo sem o profile ativo
docker compose up -d postgres redis mailpit localstack datadog-agent

# Apps no host: o .env traz OTEL_SERVICE_NAME=4frames-api; troque para o worker e o notifier
pnpm dev:api
OTEL_SERVICE_NAME=4frames-worker pnpm dev:worker
OTEL_SERVICE_NAME=4frames-notifier pnpm dev:notifier
```

No Compose, `docker-compose.yml` já define `OTEL_SERVICE_NAME` por serviço.

> **Nota:** no Agent ≥ 7.61, `HOST_PROC` no Compose deve ser `/proc` (não `/host/proc`), senão o
> pipeline OTLP não sobe (`failed to register process metrics`).

## Serviços no APM

| Processo                                  | `service.name`           |
| ----------------------------------------- | ------------------------ |
| API                                       | `4frames-api`            |
| Rotina de expiração no cluster (CronJob)  | `4frames-expire-uploads` |
| Rotina de expiração no Compose ou no host | `4frames-api`            |
| Worker                                    | `4frames-worker`         |
| Notifier                                  | `4frames-notifier`       |

## Métricas custom

Saem com `DD_METRICS_ENABLED=true` e o OTel ligado.

| Métrica                                 | Quem emite          | O que mede                                                         |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `frames.video_jobs.created`             | API                 | `POST /videos` criou o job                                         |
| `frames.video_jobs.done`                | Worker              | O job terminou em `DONE`                                           |
| `frames.video_jobs.failed`              | Worker              | O job terminou em `FAILED`, com a tag `reason`                     |
| `frames.video_jobs.processing_duration` | Worker              | Histograma em ms, do início do processamento até o `job.done`      |
| `frames.sqs.messages_visible`           | Worker              | Gauge: mensagens à espera, com a tag `queue` (`uploads` ou `dlq`)  |
| `frames.sqs.messages_in_flight`         | Worker              | Gauge: mensagens recebidas e ainda não apagadas, com a tag `queue` |
| `frames.video_jobs.stuck_processing`    | Rotina de expiração | Gauge: jobs em `PROCESSING` sem escrita há 15 min                  |

- Nomes no Datadog precisam começar com letra: `4frames.*` seria rejeitado.
- A tag `reason` é o código do motivo, não o texto: `invalid_video`, `no_video_stream`, `unsupported_format`,
  `unknown_duration`, `too_long`, `no_frames`, `source_not_found`, `retries_exhausted` (3 tentativas esgotadas, pela
  DLQ) ou `other`.
- O worker lê a fila a cada 15 s. Cada réplica publica a mesma leitura: agregue com `max`.

## Dashboard e monitores

Versionados em [`infra/datadog/`](./infra/datadog): o dashboard "4Frames" (`dashboard.json`) e três monitores
(`monitors/*.json`): DLQ com mensagens há 5 min, jobs presos em `PROCESSING` e jobs que falharam depois de 3
tentativas. Para criar ou atualizar no Datadog, com `DD_API_KEY` e `DD_APP_KEY` (Organization Settings → Application
Keys) no `.env`:

```bash
node --env-file=.env scripts/datadog-apply.mjs --dry-run   # só valida os arquivos
node --env-file=.env scripts/datadog-apply.mjs
```

O dashboard é achado pelo título e cada monitor pelo nome: rodar de novo atualiza, não duplica. Mude o JSON, não a tela:
o próximo apply sobrescreve o que for mudado no Datadog. Os monitores não notificam ninguém; para ser avisado, ponha o
seu `@` na `message`.

## Código

- Bootstrap: `import '@4frames/shared/monitoring/load';` logo depois do `env/load`, antes de qualquer outro import, em
  cada `main.ts`. A instrumentação automática só alcança os módulos carregados depois dele.
- Encerramento: `shutdownOtel()` (de `@4frames/shared/monitoring`) por último no `onShutdown` de cada app, para enviar
  o que ficou no buffer.
- Métricas: `createMonitoringMetrics()` de `@4frames/shared/monitoring`, uma vez por processo, passada aos use cases
  como dependência opcional (`MonitoringMetrics`).
- Helm values (cluster com Agent DaemonSet): [`infra/k8s/datadog-values.yaml`](./infra/k8s/datadog-values.yaml)

## Variáveis

Ver o bloco **Datadog / OpenTelemetry** em [`.env.example`](./.env.example).

| Variável                    | Para quê                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `OTEL_ENABLED`              | `true` liga o SDK (host e Compose; no Kind, quem decide é a `DD_API_KEY`)                               |
| `COMPOSE_PROFILES`          | `datadog` faz o `docker compose` subir o `datadog-agent`                                                |
| `OTEL_EXPORTER_OTLP_TARGET` | `agent` envia ao Agent em `DD_AGENT_HOST:4318`; outro valor envia direto ao `otlp.$DD_SITE` com a chave |
| `OTEL_SERVICE_NAME`         | `service.name` do processo (cai para `DD_SERVICE`)                                                      |
| `OTEL_METRICS_EXPORTER`     | `none` desliga o envio de métricas                                                                      |
| `APP_ENV`                   | `deployment.environment` dos traces e logs                                                              |
| `DD_METRICS_ENABLED`        | liga as métricas `frames.*` (com o OTel ligado)                                                         |
| `DD_API_KEY`                | chave do Agent (Compose e Kind) e do `datadog-apply`; os apps só a usam sem o Agent                     |
| `DD_APP_KEY`                | só para o `scripts/datadog-apply.mjs`                                                                   |
| `DD_SITE`                   | site do Agent do Compose e do `datadog-apply`; o do Kind está fixo no `datadog-values.yaml`             |
| `DD_AGENT_HOST`             | onde está o Agent                                                                                       |

## Links (us5)

- [APM](https://app.us5.datadoghq.com/apm/services)
- [Logs](https://app.us5.datadoghq.com/logs)
- [Metrics](https://app.us5.datadoghq.com/metric/explorer)
- [Dashboards](https://app.us5.datadoghq.com/dashboard/lists) e [Monitores](https://app.us5.datadoghq.com/monitors/manage)
- Pods e réplicas: Infrastructure → Kubernetes → Pods (só com o Agent do Kind)
