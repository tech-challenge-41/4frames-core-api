# ADR-008: Observabilidade com OpenTelemetry e Datadog Agent

## Status

Aceito. Substitui, na linha da observabilidade da tabela da seção 2.1 do
[ADR-002](./ADR-002-execucao-local-e-monorepo.md), o Prometheus + Grafana que estava previsto.

## Data

2026-09-29, quando entraram o OpenTelemetry na API, no worker e no notificador e o Datadog Agent no Compose e no
cluster Kind. Registrado no mesmo dia.

## 1. Contexto

A seção 2.3 do ADR-001 previa observabilidade com OpenTelemetry, Datadog e CloudWatch. Ao tirar a solução da AWS, o
ADR-002 deixou no lugar Prometheus e Grafana no cluster, com a situação "Previsto". Até esta decisão, a única
observabilidade eram os logs do pino, com o `jobId`, e a contagem de jobs presos em `PROCESSING` que a rotina de
expiração grava no log.

O grupo já tinha o padrão OpenTelemetry → Datadog Agent pronto em outro projeto da organização (`garagio-api`), com
conta no Datadog (site `us5`).

## 2. Decisão

### 2.1. OpenTelemetry nos três apps

- A API, a rotina de expiração, o worker e o notificador iniciam o SDK do OpenTelemetry pelo import
  `@4frames/shared/monitoring/load`, logo depois do `@4frames/shared/env/load`. `OTEL_ENABLED=true` liga o SDK; qualquer
  outro valor o deixa desligado.
- A instrumentação é a automática do Node (`@opentelemetry/auto-instrumentations-node`), com `fs` e `net` desligados.
  Os logs saem do próprio pino, que ganha `trace_id` e `span_id`.
- Traces, logs e métricas vão pelo OTLP HTTP. Cada processo se identifica por `service.name` (`4frames-api`,
  `4frames-worker`, `4frames-notifier`), com `deployment.environment` vindo de `APP_ENV`.
- No encerramento gracioso, cada app chama `shutdownOtel()` por último, e o SDK envia o que ainda está no buffer.

### 2.2. Destino: o Datadog Agent

Com `OTEL_EXPORTER_OTLP_TARGET=agent`, os apps enviam para `http://$DD_AGENT_HOST:4318` e não guardam chave nenhuma. O
Agent repassa ao Datadog com a `DD_API_KEY`. O exportador também sabe enviar direto ao `otlp.$DD_SITE`, com a chave no
app, mas nenhum ambiente usa esse caminho.

| Onde rodam os apps     | Agent                                                                                           | `DD_AGENT_HOST`            |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------- |
| No host (`pnpm dev:*`) | Serviço `datadog-agent` do Compose (`gcr.io/datadoghq/agent:7`), com o OTLP em `localhost:4318` | `localhost`, do `.env`     |
| No Compose             | O mesmo serviço                                                                                 | `datadog-agent`            |
| No Kind                | DaemonSet do chart `datadog/datadog`, com o OTLP na porta 4318 do nó                            | IP do nó (`status.hostIP`) |
| No Kind efêmero do CD  | Nenhum                                                                                          | Telemetria desligada       |

- No cluster, o `k8s-local.sh up` instala o chart pelo Helm no namespace `datadog`, antes dos apps, com os valores de
  `infra/k8s/datadog-values.yaml`: o Agent em cada nó, o Cluster Agent e o kube-state-metrics. A `DD_API_KEY` do `.env`
  vai para o Secret `datadog-agent-secret`, separado do Secret dos apps.
- `OTEL_ENABLED` é `false` no `base` e `true` no overlay `local`. O overlay `ci` do CD herda o `false`.

### 2.3. Métricas do job

| Métrica                                 | Tipo                         | Quem emite | Quando                                                                |
| --------------------------------------- | ---------------------------- | ---------- | --------------------------------------------------------------------- |
| `frames.video_jobs.created`             | Contador                     | API        | `POST /videos` cria o job                                             |
| `frames.video_jobs.done`                | Contador                     | Worker     | O job termina em `DONE`                                               |
| `frames.video_jobs.failed`              | Contador, com a tag `reason` | Worker     | O vídeo é rejeitado (`InvalidVideoError`) e o job termina em `FAILED` |
| `frames.video_jobs.processing_duration` | Histograma, em ms            | Worker     | Do início do processamento, download incluído, até o `job.done`       |

- Os nomes começam com `frames.`, porque o Datadog rejeita métrica que começa com dígito, como `4frames.*`.
- `DD_METRICS_ENABLED` liga as métricas. Os use cases recebem a interface `MonitoringMetrics` como dependência
  opcional e não importam o OpenTelemetry. Com a flag desligada, a implementação não faz nada, e os testes não
  precisam do SDK.
- No cluster, os histogramas chegam ao Datadog como distribuições.

## 3. Consequências

### 3.1. Positivas

- A observabilidade volta ao que o ADR-001 previa, sem o CloudWatch.
- Traces, logs e métricas de cada serviço ficam num lugar só. No cluster, o Agent também mostra pods e réplicas de API e
  worker ao longo do tempo, sem instrumentação no código.
- Os use cases dependem de uma interface, não do Datadog. Trocar o backend é trocar o destino do OTLP.
- Só o Agent tem a chave do Datadog. Os apps e o Secret deles não mudam.

### 3.2. Negativas e trade-offs

- **O cluster local passa a exigir uma conta no Datadog.** O `up` para no passo do Agent sem `DD_API_KEY`, e o
  `.env.example` vem sem ela. Quem avalia precisa de uma chave para subir a solução, o que contraria o "sem conta de
  nuvem" dos ADR-002 e ADR-003. Logs, traces e métricas saem da máquina para o Datadog.
- Mais pré-requisitos e mais memória: `helm` e `envsubst` passam a ser exigidos pelo `up`. O Agent pede 512 MiB, com
  limite de 1,25 GiB, fora o Cluster Agent e o kube-state-metrics, e o `up` espera o chart ficar pronto por até 8 min.
- No Compose, `OTEL_ENABLED` vem fixo em `true` para os apps, e o `.env` não o desliga.
- `frames.video_jobs.failed` só conta vídeos rejeitados. Um job que falha na DLQ ("Falha após 3 tentativas") não entra.
  A tag `reason` do vídeo longo demais traz a duração no texto, então gera um valor novo por duração.
- O trace de um job para na fila: a mensagem do SQS é criada pelo S3, não pela API, e o worker começa um trace novo. O
  `correlation_id` de `video_jobs` continua sem uso.
- Nenhum app envia a profundidade da fila SQS, e nenhum dashboard ou monitor (alerta) do Datadog está versionado no
  repositório. Não há alerta para a DLQ nem para job preso.
- A partida do SDK (`monitoring/otel.ts` e `monitoring/load.ts`) fica fora da cobertura do `shared`. O CD roda sem
  Agent, então nenhum teste automatizado prova que a telemetria chega ao Datadog.

## 4. Relação com outros ADRs

- Substitui o Prometheus + Grafana que o ADR-002 previa e volta ao OpenTelemetry com o Datadog da seção 2.3 do ADR-001.
  O CloudWatch continua de fora.
- Acrescenta a instalação do Agent ao comando único da seção 2.7 do
  [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md), antes do deploy dos apps.
- O CD do [ADR-007](./ADR-007-qualidade-testes-e-entrega.md) não instala o Agent e roda com a telemetria desligada.
- Operação, variáveis e onde ver cada coisa no Datadog: [`DATADOG_README.md`](../../DATADOG_README.md).
