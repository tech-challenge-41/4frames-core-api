# Datadog — desenvolvimento local (4Frames)

Mesmo padrão do **garagio-api**: OpenTelemetry nos apps → OTLP HTTP → **Datadog Agent** → site `us5`. A decisão e
os trade-offs estão no [ADR-008](./docs/adr/ADR-008-observabilidade-opentelemetry-datadog.md).

## Pré-requisitos

- Conta no Datadog, no site `us5.datadoghq.com`, e a API key dela em `DD_API_KEY` no `.env` (gitignored). O
  `.env.example` vem sem a chave.
- Para o cluster Kind: `helm` e `envsubst` no PATH, além do que o `k8s-local.sh` já pedia. O Git Bash do Windows já
  traz o `envsubst`; o `helm` precisa ser instalado.

Sem `DD_API_KEY`, o `./scripts/k8s-local.sh up` para no passo do Agent, depois de criar o cluster e carregar as
imagens, com `DD_API_KEY ausente no .env`.

## Stack

| Modo                                  | Agent                                                                | Como os apps chegam ao Agent                            |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Apps no host (`pnpm dev:*`)           | serviço `datadog-agent` do Compose, OTLP em `:4318`                  | `DD_AGENT_HOST=localhost` (`.env`)                      |
| `docker compose up` (apps no Compose) | o mesmo serviço                                                      | `DD_AGENT_HOST=datadog-agent` (`x-container-endpoints`) |
| `./scripts/k8s-local.sh up` (Kind)    | **Helm**: DaemonSet no namespace `datadog`, OTLP na porta 4318 do nó | `DD_AGENT_HOST=status.hostIP` em cada Deployment        |

- No Kind, o Agent do Compose não é usado: o `k8s-local.sh` sobe no Compose só Postgres, Redis, Mailpit e
  LocalStack, e instala o chart `datadog/datadog` com os valores de
  [`infra/k8s/datadog-values.yaml`](./infra/k8s/datadog-values.yaml) (Agent, Cluster Agent e kube-state-metrics). A
  chave vai para o Secret `datadog-agent-secret`, no namespace `datadog`.
- O overlay `local` só liga o `OTEL_ENABLED` e põe `DD_ENV`/`APP_ENV` em `development`. O `base` deixa o OTel
  desligado, e o CD (overlay `ci`) roda sem Agent.

```bash
# Infra com o Agent, para os apps no host
docker compose up -d postgres redis mailpit localstack datadog-agent

# Apps no host: o .env traz OTEL_SERVICE_NAME=4frames-api; troque para o worker e o notifier
pnpm dev:api
OTEL_SERVICE_NAME=4frames-worker pnpm dev:worker
OTEL_SERVICE_NAME=4frames-notifier pnpm dev:notifier
```

No Compose, `docker-compose.yml` já define `OTEL_SERVICE_NAME` por serviço.

> **Nota:** no Agent ≥ 7.61, `HOST_PROC` no Compose deve ser `/proc` (não `/host/proc`), senão o
> pipeline OTLP não sobe (`failed to register process metrics`).

### Rodar sem o Datadog

- **Apps no host:** `OTEL_ENABLED=false` no `.env`. Com o OTel ligado e sem Agent, os exportadores falham a cada envio.
- **Compose:** o `x-container-endpoints` fixa `OTEL_ENABLED: 'true'`, que vale mais que o `.env`. É preciso mudar no
  `docker-compose.yml`.
- **Kind:** não há como; o `up` exige a `DD_API_KEY`.

## Serviços no APM

| Processo                      | `service.name`     |
| ----------------------------- | ------------------ |
| API (e a rotina de expiração) | `4frames-api`      |
| Worker                        | `4frames-worker`   |
| Notifier                      | `4frames-notifier` |

## Métricas custom (quando `DD_METRICS_ENABLED=true`)

| Métrica                                 | Quem emite | Quando                                                        |
| --------------------------------------- | ---------- | ------------------------------------------------------------- |
| `frames.video_jobs.created`             | API        | `POST /videos` cria o job                                     |
| `frames.video_jobs.done`                | Worker     | O job termina em `DONE`                                       |
| `frames.video_jobs.failed`              | Worker     | Vídeo rejeitado (`FAILED` com motivo), com a tag `reason`     |
| `frames.video_jobs.processing_duration` | Worker     | Histograma em ms, do início do processamento até o `job.done` |

- Nomes no Datadog precisam começar com letra: `4frames.*` seria rejeitado.
- O `failed` não conta os jobs que falham na DLQ depois de 3 tentativas.
- Nenhuma métrica traz a profundidade da fila SQS, e nenhum dashboard ou monitor do Datadog está versionado no
  repositório.

## Código

- Bootstrap: `import '@4frames/shared/monitoring/load'` logo depois do `env/load`, em cada `main.ts`. A
  instrumentação automática só alcança os módulos carregados depois dele.
- Encerramento: `shutdownOtel()` por último no `onShutdown` de cada app, para enviar o que ficou no buffer.
- Exportadores e métricas: `@4frames/shared/monitoring` (`DatadogOTLPExporter`, `createMonitoringMetrics`). Os use
  cases recebem `MonitoringMetrics` como dependência opcional.
- Helm values (cluster com Agent DaemonSet): [`infra/k8s/datadog-values.yaml`](./infra/k8s/datadog-values.yaml)

## Variáveis

Ver o bloco **Datadog / OpenTelemetry** em [`.env.example`](./.env.example).

| Variável                    | Para quê                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `OTEL_ENABLED`              | `true` liga o SDK                                                                                       |
| `OTEL_EXPORTER_OTLP_TARGET` | `agent` envia ao Agent em `DD_AGENT_HOST:4318`; outro valor envia direto ao `otlp.$DD_SITE` com a chave |
| `OTEL_SERVICE_NAME`         | `service.name` do processo (cai para `DD_SERVICE`)                                                      |
| `OTEL_METRICS_EXPORTER`     | `none` desliga o envio de métricas                                                                      |
| `APP_ENV`                   | `deployment.environment` dos traces e logs                                                              |
| `DD_METRICS_ENABLED`        | liga as métricas `frames.video_jobs.*`                                                                  |
| `DD_API_KEY`                | chave do Agent (Compose e Kind); os apps só a usam sem o Agent                                          |
| `DD_SITE`                   | site do Agent do Compose; o do Kind está fixo no `datadog-values.yaml`                                  |
| `DD_AGENT_HOST`             | onde está o Agent                                                                                       |

`DD_APP_KEY` está no `.env.example`, mas nenhum app nem script a usa.

## Links (us5)

- [APM](https://app.us5.datadoghq.com/apm/services)
- [Logs](https://app.us5.datadoghq.com/logs)
- [Metrics](https://app.us5.datadoghq.com/metric/explorer)
- Pods e réplicas: Infrastructure → Kubernetes → Pods (só com o Agent do Kind)
