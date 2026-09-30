# Datadog — desenvolvimento local (4Frames)

Mesmo padrão do **garagio-api**: OpenTelemetry nos apps → OTLP HTTP → **Datadog Agent** → site `us5`.

## Stack

| Modo                               | Agent                                     | Onde ver                                            |
| ---------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `docker compose` (apps no Compose) | serviço `datadog-agent` (`:4318`)         | APM / Logs                                          |
| `./scripts/k8s-local.sh up` (Kind) | **Helm** DaemonSet no namespace `datadog` | APM / Logs / **Infrastructure → Kubernetes → Pods** |

No Kind, as apps usam `DD_AGENT_HOST=status.hostIP` (mesmo padrão do garagio-api). O Agent do Compose
não é necessário para o cluster — o `k8s-local.sh` sobe só Postgres/Redis/Mailpit/LocalStack no host.

```bash
# Infra (inclui o Agent) — também usado pelo Kind via k8s-local.sh
docker compose up -d postgres redis mailpit localstack datadog-agent

# Apps no host
OTEL_SERVICE_NAME=4frames-api pnpm dev:api
# (worker/notifier idem; Compose já define OTEL_SERVICE_NAME por serviço)
```

No Kind local, o overlay aponta `DD_AGENT_HOST=host.docker.internal` (porta `4318` no host).

> **Nota:** no Agent ≥ 7.61, `HOST_PROC` no Compose deve ser `/proc` (não `/host/proc`), senão o
> pipeline OTLP não sobe (`failed to register process metrics`).

## Serviços no APM

| Processo | `service.name`     |
| -------- | ------------------ |
| API      | `4frames-api`      |
| Worker   | `4frames-worker`   |
| Notifier | `4frames-notifier` |

## Métricas custom (quando `DD_METRICS_ENABLED=true`)

- `frames.video_jobs.created`
- `frames.video_jobs.done`
- `frames.video_jobs.failed`
- `frames.video_jobs.processing_duration` (histogram, ms)

> Nomes no Datadog precisam começar com letra — `4frames.*` seria rejeitado.

## Código

- Bootstrap: `import '@4frames/shared/monitoring/load'` (depois de `env/load`) em cada `main.ts`
- Exportadores: `@4frames/shared/monitoring` (`DatadogOTLPExporter`, `createMonitoringMetrics`)
- Helm values (cluster com Agent DaemonSet): [`infra/k8s/datadog-values.yaml`](./infra/k8s/datadog-values.yaml)

## Variáveis

Ver bloco **Datadog / OpenTelemetry** em [`.env.example`](./.env.example). A chave `DD_API_KEY` fica só no `.env` (gitignored).

## Links (us5)

- [APM](https://app.us5.datadoghq.com/apm/services)
- [Logs](https://app.us5.datadoghq.com/logs)
- [Metrics](https://app.us5.datadoghq.com/metric/explorer)
