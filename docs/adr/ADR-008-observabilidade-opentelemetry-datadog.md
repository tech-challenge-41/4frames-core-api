# ADR-008: Observabilidade com OpenTelemetry e Datadog Agent

## Status

Aceito. Substitui, na linha da observabilidade da tabela da seção 2.1 do
[ADR-002](./ADR-002-execucao-local-e-monorepo.md), o Prometheus + Grafana que estava previsto.

## Data

2026-09-29, quando entraram o OpenTelemetry na API, no worker e no notificador e o Datadog Agent no Compose e no
cluster Kind. No mesmo dia o Agent virou opcional e entraram as métricas da fila e dos jobs presos, o dashboard e os
monitores versionados. Registrado no mesmo dia.

## 1. Contexto

A seção 2.3 do ADR-001 previa observabilidade com OpenTelemetry, Datadog e CloudWatch. Ao tirar a solução da AWS, o
ADR-002 deixou no lugar Prometheus e Grafana no cluster, com a situação "Previsto". Até esta decisão, a única
observabilidade eram os logs do pino, com o `jobId`, e a contagem de jobs presos em `PROCESSING` que a rotina de
expiração grava no log.

O grupo já tinha o padrão OpenTelemetry → Datadog Agent pronto em outro projeto da organização (`garagio-api`), com
conta no Datadog (site `us5`). A solução, porém, precisa continuar subindo sem conta de nuvem (ADR-002 e ADR-003): quem
avalia não tem, necessariamente, uma conta no Datadog.

## 2. Decisão

### 2.1. OpenTelemetry nos três apps

- A API, a rotina de expiração, o worker e o notificador iniciam o SDK do OpenTelemetry pelo import de efeito colateral
  `import '@4frames/shared/monitoring/load'`, logo depois do `@4frames/shared/env/load` e antes de qualquer outro
  módulo: a instrumentação automática só alcança o que é carregado depois do SDK. `OTEL_ENABLED=true` liga o SDK;
  qualquer outro valor o deixa desligado.
- A instrumentação é a automática do Node (`@opentelemetry/auto-instrumentations-node`), com `fs` e `net` desligados.
  Os logs saem do próprio pino, que ganha `trace_id` e `span_id`.
- Traces, logs e métricas vão pelo OTLP HTTP. Cada processo se identifica por `service.name` (`4frames-api`,
  `4frames-worker`, `4frames-notifier` e, no cluster, `4frames-expire-uploads`), com `deployment.environment` vindo de
  `APP_ENV`.
- No encerramento gracioso, cada app chama `shutdownOtel()` por último, e o SDK envia o que ainda está no buffer.

### 2.2. Destino: o Datadog Agent, que é opcional

Com `OTEL_EXPORTER_OTLP_TARGET=agent`, os apps enviam para `http://$DD_AGENT_HOST:4318` e não guardam chave nenhuma. O
Agent repassa ao Datadog com a `DD_API_KEY`. O exportador também sabe enviar direto ao `otlp.$DD_SITE`, com a chave no
app, mas nenhum ambiente usa esse caminho.

Sem conta no Datadog, tudo sobe igual, sem telemetria. O `.env.example` vem com o OTel desligado e sem chave.

| Onde rodam os apps     | Como ligar                                                     | Agent                                                                       | `DD_AGENT_HOST`            |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| No host (`pnpm dev:*`) | `DD_API_KEY`, `OTEL_ENABLED=true` e `COMPOSE_PROFILES=datadog` | Serviço `datadog-agent` do Compose, no profile `datadog`, em `:4318`        | `localhost`, do `.env`     |
| No Compose             | O mesmo                                                        | O mesmo serviço; a dependência dos apps nele é opcional (`required: false`) | `datadog-agent`            |
| No Kind                | Só a `DD_API_KEY`                                              | DaemonSet do chart `datadog/datadog`, com o OTLP na porta 4318 do nó        | IP do nó (`status.hostIP`) |
| No Kind efêmero do CD  | Não liga                                                       | Nenhum                                                                      | Telemetria desligada       |

- No cluster, com `DD_API_KEY` no `.env`, o `k8s-local.sh up` exige `helm` e `envsubst` e instala o chart pelo Helm no
  namespace `datadog`, antes dos apps, com os valores de `infra/k8s/datadog-values.yaml`: o Agent em cada nó, o Cluster
  Agent e o kube-state-metrics. A chave vai para o Secret `datadog-agent-secret`, separado do Secret dos apps.
- Sem a chave, o `up` pula o Agent, não pede `helm` nem `envsubst` e aplica o overlay `local` com o `OTEL_ENABLED`
  trocado para `false`, para os apps não acumularem falhas de exportação.
- `OTEL_ENABLED` é `false` no `base` e `true` no overlay `local`. O overlay `ci` do CD herda o `false`.

### 2.3. Métricas do job e da fila

| Métrica                                 | Tipo                         | Quem emite          | O que mede                                                                  |
| --------------------------------------- | ---------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `frames.video_jobs.created`             | Contador                     | API                 | `POST /videos` criou o job                                                  |
| `frames.video_jobs.done`                | Contador                     | Worker              | O job terminou em `DONE`                                                    |
| `frames.video_jobs.failed`              | Contador, com a tag `reason` | Worker              | O job terminou em `FAILED`: vídeo rejeitado ou 3 tentativas esgotadas (DLQ) |
| `frames.video_jobs.processing_duration` | Histograma, em ms            | Worker              | Do início do processamento, download incluído, até o `job.done`             |
| `frames.sqs.messages_visible`           | Gauge, com a tag `queue`     | Worker              | Mensagens à espera na fila de uploads e na DLQ, lidas a cada 15 s           |
| `frames.sqs.messages_in_flight`         | Gauge, com a tag `queue`     | Worker              | Mensagens recebidas e ainda não apagadas                                    |
| `frames.video_jobs.stuck_processing`    | Gauge                        | Rotina de expiração | Jobs em `PROCESSING` sem escrita há 15 min, a cada passada                  |

- Os nomes começam com `frames.`, porque o Datadog rejeita métrica que começa com dígito, como `4frames.*`.
- A tag `reason` é um código fixo (`invalid_video`, `too_long`, `retries_exhausted`…), não o texto mostrado ao usuário:
  o texto do vídeo longo demais traz a duração, e cada duração viraria uma série.
- Uma falha só conta quando o `FAILED` foi gravado. Uma entrega duplicada de um job que já saiu de `PROCESSING` não
  conta de novo.
- `DD_METRICS_ENABLED` e `OTEL_ENABLED` ligam as métricas. Os use cases recebem a interface `MonitoringMetrics` como
  dependência opcional e não importam o OpenTelemetry. Desligada, a implementação não faz nada e diz isso
  (`enabled: false`), e o worker nem consulta a fila.
- No cluster, os histogramas chegam ao Datadog como distribuições.

### 2.4. Dashboard e monitores versionados

O dashboard "4Frames" e os monitores ficam em `infra/datadog/`, em JSON, e o `scripts/datadog-apply.mjs` os cria ou
atualiza pela API do Datadog, com `DD_API_KEY` e `DD_APP_KEY`. O dashboard é achado pelo título e cada monitor pelo
nome, então rodar de novo não duplica.

- **Dashboard:** a fila de uploads ao lado das réplicas de worker, as réplicas da API, os jobs criados, concluídos e com
  falha, as falhas por motivo, o tempo de processamento (p50 e p95), os jobs presos e a DLQ.
- **Monitores:** a DLQ com mensagens por 5 min (o worker a drena em segundos, então o consumidor dela parou), jobs
  presos em `PROCESSING` e jobs que falharam depois de 3 tentativas.

## 3. Consequências

### 3.1. Positivas

- A observabilidade volta ao que o ADR-001 previa, sem o CloudWatch, e a solução continua subindo sem conta de nuvem.
- Traces, logs e métricas de cada serviço ficam num lugar só. No cluster, o Agent também mostra pods e réplicas de API e
  worker ao longo do tempo, sem instrumentação no código.
- O pico fica visível no Datadog: a fila, as réplicas que o KEDA sobe e os jobs concluídos, no mesmo painel.
- Os use cases dependem de uma interface, não do Datadog. Trocar o backend é trocar o destino do OTLP.
- Só o Agent tem a chave do Datadog. Os apps e o Secret deles não mudam.

### 3.2. Negativas e trade-offs

- **Sem conta no Datadog, não há telemetria nenhuma.** A solução sobe e funciona, mas só com os logs dos pods.
- Com o Datadog ligado, o cluster pede mais: `helm` e `envsubst`, e o Agent pede 512 MiB, com limite de 1,25 GiB, fora o
  Cluster Agent e o kube-state-metrics. O `up` espera o chart ficar pronto por até 8 min. Logs, traces e métricas saem da
  máquina para o Datadog.
- Ligar no Compose pede três variáveis (`DD_API_KEY`, `OTEL_ENABLED` e `COMPOSE_PROFILES`), e no cluster basta uma.
- O trace de um job para na fila: a mensagem do SQS é criada pelo S3, não pela API, e o worker começa um trace novo. O
  `correlation_id` de `video_jobs` continua sem uso; o que liga as pontas é o `jobId` nos logs.
- Cada réplica do worker consulta a fila a cada 15 s, só para a métrica: no pico, com 5 réplicas, são 10 chamadas ao SQS
  a cada 15 s. No Datadog, a fila é agregada com `max`.
- Os monitores não notificam ninguém: a mensagem não tem `@` de pessoa nem de canal. Quem quiser ser avisado acrescenta
  no JSON. O que for mudado na tela do Datadog é sobrescrito no próximo `datadog-apply`.
- A partida do SDK (`monitoring/otel.ts` e `monitoring/load.ts`) fica fora da cobertura do `shared`. O CD roda sem
  Agent, e o `datadog-apply` só valida os arquivos no `--dry-run`: nenhum teste automatizado prova que a telemetria, o
  dashboard e os monitores chegam ao Datadog.

## 4. Relação com outros ADRs

- Substitui o Prometheus + Grafana que o ADR-002 previa e volta ao OpenTelemetry com o Datadog da seção 2.3 do ADR-001.
  O CloudWatch continua de fora.
- Acrescenta ao comando único da seção 2.7 do [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md) a instalação
  do Agent, antes do deploy dos apps, só quando há `DD_API_KEY`.
- Os monitores de DLQ, de falha depois de 3 tentativas e de jobs presos observam os caminhos de falha do
  [ADR-005](./ADR-005-ciclo-de-vida-do-job.md).
- O CD do [ADR-007](./ADR-007-qualidade-testes-e-entrega.md) não instala o Agent e roda com a telemetria desligada.
- Operação, variáveis e onde ver cada coisa no Datadog: [`DATADOG_README.md`](../../DATADOG_README.md).
