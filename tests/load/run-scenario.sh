#!/usr/bin/env bash
#
# Cenário de escala do worker, com evidência em docs/evidence/<nome>/:
#   - um pico de uploads com o k6 (uploads.js): VIDEOS vídeos enviados ao mesmo tempo, como pelo front;
#   - USERS usuários com a listagem aberta durante o pico (listagem.js);
#   - o KEDA subindo e descendo workers pela fila, gravado por sampler.mjs;
#   - no fim, os jobs do cenário no banco e o gráfico (chart.mjs).
#
# Pré-requisitos: a stack no ar (./scripts/k8s-local.sh up), Docker, kubectl, curl e Node.
#
# Uso:
#   tests/load/run-scenario.sh <nome> <máximo de workers> [--reduzir-no-meio]
#
#   tests/load/run-scenario.sh 1-worker 1                              # o KEDA limitado a 1: um worker fixo
#   tests/load/run-scenario.sh keda-ate-5 5                            # o KEDA livre, de 1 a 5 workers
#   tests/load/run-scenario.sh reducao-no-meio 5 --reduzir-no-meio     # com 5 vídeos em processamento, o máximo cai
#                                                                      # para 1: 4 workers saem no meio do vídeo
#
# Variáveis: VIDEOS (10), USERS (10), LISTAGEM_DURATION (duração da listagem no k6, 4m), K6_IMAGE.
# Os jobs do cenário ficam com o user@user.com e com o nome começando pelo id da execução, que separa a contagem
# de qualquer outro job do banco. No fim, mesmo com falha, o ScaledObject volta a 1–5.
#
set -euo pipefail

NAME="${1:?uso: tests/load/run-scenario.sh <nome> <máximo de workers> [--reduzir-no-meio]}"
MAX_REPLICAS="${2:?informe o máximo de workers}"
MODE="${3:-}"
VIDEOS="${VIDEOS:-10}"
USERS="${USERS:-10}"
LISTAGEM_DURATION="${LISTAGEM_DURATION:-4m}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.3.0}"
NAMESPACE="4frames"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/docs/evidence/$NAME"
RUN_ID="k6-$NAME-$(date +%s)"
LISTAGEM_CONTAINER="$RUN_ID-listagem"
SQS_ENDPOINT="http://localhost:4566/"
QUEUE_URL="http://localhost:4566/000000000000/4frames-video-uploads"
# Os valores do infra/k8s/base/worker-scaledobject.yaml, restaurados no fim.
DEFAULT_MIN_REPLICAS=1
DEFAULT_MAX_REPLICAS=5
SAMPLER_PID=""
LISTAGEM_PID=""

now_ms() {
  date +%s%3N
}

# Marco do cenário: vai para o events.log (usado no gráfico) e para a tela.
event() {
  printf '%s %s\n' "$(now_ms)" "$*" >>"$OUT_DIR/events.log"
  printf '[%s] %s\n' "$(date +%T)" "$*"
}

# Caminho que o Docker do host entende para montar volumes (no Git Bash, C:/...).
host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

sql() {
  (cd "$ROOT_DIR" && docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F, -c "$0"' "$1")
}

# "<visíveis> <em processamento>" da fila de uploads.
queue_depth() {
  curl -s "$SQS_ENDPOINT" \
    -H 'Content-Type: application/x-amz-json-1.0' \
    -H 'X-Amz-Target: AmazonSQS.GetQueueAttributes' \
    -d "{\"QueueUrl\":\"$QUEUE_URL\",\"AttributeNames\":[\"ApproximateNumberOfMessages\",\"ApproximateNumberOfMessagesNotVisible\"]}" |
    sed -E 's/.*"ApproximateNumberOfMessages": *"([0-9]+)".*"ApproximateNumberOfMessagesNotVisible": *"([0-9]+)".*/\1 \2/'
}

# "<desejadas> <prontas>" do Deployment do worker.
worker_replicas() {
  kubectl -n "$NAMESPACE" get deploy worker -o jsonpath='{.spec.replicas} {.status.readyReplicas}' | awk '{ print $1, ($2 == "" ? 0 : $2) }'
}

set_scaled_object() {
  kubectl -n "$NAMESPACE" patch scaledobject worker --type merge \
    -p "{\"spec\":{\"minReplicaCount\":$1,\"maxReplicaCount\":$2}}" >/dev/null
}

# wait_until <descrição> <timeout em s> <comando...>: repete o comando até ele dar certo.
wait_until() {
  local description="$1" timeout="$2" deadline
  shift 2
  deadline=$((SECONDS + timeout))

  until "$@"; do
    if ((SECONDS > deadline)); then
      echo "Tempo esgotado esperando: $description" >&2
      return 1
    fi
    sleep 2
  done
}

queue_empty() {
  [[ "$(queue_depth)" == "0 0" ]]
}

workers_at_minimum() {
  [[ "$(worker_replicas)" == "$DEFAULT_MIN_REPLICAS $DEFAULT_MIN_REPLICAS" ]] &&
    [[ "$(kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/name=worker --no-headers 2>/dev/null | wc -l)" -eq "$DEFAULT_MIN_REPLICAS" ]]
}

# Todos os workers permitidos estão prontos e cada um processa um vídeo.
workers_all_busy() {
  local replicas inflight
  replicas="$(worker_replicas)"
  inflight="$(queue_depth | awk '{ print $2 }')"
  [[ "$replicas" == "$MAX_REPLICAS $MAX_REPLICAS" ]] && ((inflight >= MAX_REPLICAS))
}

all_jobs_finished() {
  local finished
  finished="$(sql "select count(*) from video_jobs where file_name like '$RUN_ID%' and status in ('DONE','FAILED','EXPIRED')")"
  ((finished >= VIDEOS))
}

cleanup() {
  touch "$OUT_DIR/.stop"
  docker rm -f "$LISTAGEM_CONTAINER" >/dev/null 2>&1 || true
  set_scaled_object "$DEFAULT_MIN_REPLICAS" "$DEFAULT_MAX_REPLICAS" || true
  if [[ -n "$SAMPLER_PID" ]]; then
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
  rm -f "$OUT_DIR/.stop"
}

k6_run() {
  local script="$1" summary="$2"
  shift 2
  MSYS_NO_PATHCONV=1 docker run --rm --add-host host.docker.internal:host-gateway \
    -v "$(host_path "$ROOT_DIR/tests/load"):/scripts:ro" \
    -v "$(host_path "$ROOT_DIR/apps/worker/test/fixtures"):/fixtures:ro" \
    -v "$(host_path "$OUT_DIR"):/out" \
    "$@" "$K6_IMAGE" run --quiet --summary-export "/out/$summary" "/scripts/$script"
}

main() {
  for tool in docker kubectl curl node; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "Falta $tool no PATH." >&2
      exit 1
    }
  done
  curl -sf -o /dev/null http://localhost:8080/api/ready || {
    echo "A stack não responde em http://localhost:8080/api/ready. Rode ./scripts/k8s-local.sh up antes." >&2
    exit 1
  }

  mkdir -p "$OUT_DIR"
  rm -f "$OUT_DIR"/{events.log,replicas.log,pods-watch.log,pods-events.log,queue.csv,jobs.csv,k6-*,worker-*.log,timeline.svg,resumo.md,.stop}
  trap cleanup EXIT

  echo "Cenário $NAME: $VIDEOS vídeos, $USERS usuários na listagem, até $MAX_REPLICAS worker(s). Execução $RUN_ID."
  set_scaled_object "$DEFAULT_MIN_REPLICAS" "$MAX_REPLICAS"
  wait_until "fila vazia" 300 queue_empty
  wait_until "workers no mínimo ($DEFAULT_MIN_REPLICAS)" 360 workers_at_minimum

  NAMESPACE="$NAMESPACE" node "$ROOT_DIR/tests/load/sampler.mjs" "$OUT_DIR" &
  SAMPLER_PID=$!
  sleep 3
  event "início: $VIDEOS vídeos, máximo de $MAX_REPLICAS worker(s)"

  k6_run listagem.js k6-listagem.json --name "$LISTAGEM_CONTAINER" \
    -e USERS="$USERS" -e DURATION="$LISTAGEM_DURATION" >"$OUT_DIR/k6-listagem.txt" 2>&1 &
  LISTAGEM_PID=$!

  local uploads_status=0
  k6_run uploads.js k6-uploads.json -e VIDEOS="$VIDEOS" -e RUN_ID="$RUN_ID" >"$OUT_DIR/k6-uploads.txt" 2>&1 ||
    uploads_status=$?
  event "uploads enviados (k6 saiu com $uploads_status)"

  if [[ "$MODE" == "--reduzir-no-meio" ]]; then
    wait_until "$MAX_REPLICAS workers ocupados" 300 workers_all_busy
    # Os logs somem com o pod: acompanha cada worker desde já, para registrar o encerramento gracioso.
    for pod in $(kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/name=worker -o name); do
      kubectl -n "$NAMESPACE" logs -f "$pod" >"$OUT_DIR/${pod#pod/}.log" 2>&1 &
    done
    set_scaled_object "$DEFAULT_MIN_REPLICAS" "$DEFAULT_MIN_REPLICAS"
    event "máximo reduzido para 1 com $(queue_depth | awk '{ print $2 }') vídeos em processamento"
  fi

  wait_until "todos os $VIDEOS jobs terminarem" 1200 all_jobs_finished
  event "todos os jobs terminaram"
  wait_until "workers voltarem ao mínimo" 600 workers_at_minimum
  event "workers de volta ao mínimo"

  local listagem_status=0
  wait "$LISTAGEM_PID" || listagem_status=$?
  touch "$OUT_DIR/.stop"
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=""

  {
    echo 'arquivo,status,criado_ms,atualizado_ms,motivo'
    sql "select file_name, status, (extract(epoch from created_at) * 1000)::bigint,
                (extract(epoch from updated_at) * 1000)::bigint, coalesce(failure_reason, '')
         from video_jobs where file_name like '$RUN_ID%' order by created_at"
  } >"$OUT_DIR/jobs.csv"

  local result=0
  node "$ROOT_DIR/tests/load/chart.mjs" "$OUT_DIR" "$NAME" "$MAX_REPLICAS" "$VIDEOS" \
    "$uploads_status" "$listagem_status" || result=$?

  # O format:check do repositório cobre md e json: o que o cenário gera já sai formatado.
  (cd "$ROOT_DIR" && pnpm exec prettier --write --log-level warn "docs/evidence/$NAME/*.{md,json}") || true

  return "$result"
}

main "$@"
