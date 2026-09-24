#!/usr/bin/env bash
#
# Sobe um cluster Kind local no mesmo padrão do garagio-api:
#   - Manifestos plain YAML em k8s/
#   - envsubst + IMAGE_PLACEHOLDER
#   - Comandos: up | down | logs | status
#
# Diferenças do 4Frames (ADR-002):
#   - Infra (postgres/redis/localstack/mailpit) no Compose no host
#   - Worker + KEDA pela profundidade da fila SQS
#
# Pré-requisitos: docker, kind, kubectl, envsubst (.env na raiz)
#
# Uso:
#   ./scripts/k8s-local.sh up
#   ./scripts/k8s-local.sh logs
#   ./scripts/k8s-local.sh status
#   ./scripts/k8s-local.sh down
#
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-4frames-local}"
API_IMAGE="${API_IMAGE:-4frames-api:local}"
WORKER_IMAGE="${WORKER_IMAGE:-4frames-worker:local}"
KEDA_VERSION="${KEDA_VERSION:-2.16.1}"
NAMESPACE_APP="default"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# No Linux, kind não popula host.docker.internal. Usa o gateway da rede `kind`
# (alcança portas publicadas no host: Postgres, Redis, LocalStack).
detect_host_gateway() {
  local gw
  # IPAM pode ter entrada IPv6 sem Gateway primeiro — pega o primeiro Gateway IPv4.
  gw="$(docker network inspect kind -f '{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}} {{end}}{{end}}' 2>/dev/null | awk '{print $1}')"
  if [[ -n "$gw" ]]; then
    echo "$gw"
    return
  fi
  echo "host.docker.internal"
}

load_env() {
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    echo "Erro: $ROOT_DIR/.env não encontrado (cp .env.example .env)" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a

  # Defaults alinhados ao kind + Compose no host (override no .env se precisar).
  HOST_GATEWAY="$(detect_host_gateway)"
  echo "Host gateway para pods: $HOST_GATEWAY"

  export APP_ENV="${APP_ENV:-local}"
  export AWS_REGION="${AWS_REGION:-us-east-1}"
  export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:5173,http://localhost:8080}"
  export DB_HOST="${DB_HOST_K8S:-$HOST_GATEWAY}"
  export DB_PORT="${DB_PORT:-5432}"
  export DB_DATABASE="${DB_DATABASE:-4frames_core}"
  export DB_SCHEMA="${DB_SCHEMA:-public}"
  export DB_USERNAME="${DB_USERNAME:-admin}"
  export DB_PASSWORD="${DB_PASSWORD:-123456}"
  export JWT_SECRET_KEY="${JWT_SECRET_KEY:-change_me}"
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
  export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL_K8S:-http://${HOST_GATEWAY}:4566}"
  export S3_PUBLIC_ENDPOINT_URL="${S3_PUBLIC_ENDPOINT_URL:-http://localhost:4566}"
  export S3_BUCKET_NAME="${S3_BUCKET_NAME:-4frames-videos}"
  export SQS_QUEUE_URL="${SQS_QUEUE_URL_K8S:-http://${HOST_GATEWAY}:4566/000000000000/4frames-video-uploads}"
  export SQS_DLQ_URL="${SQS_DLQ_URL_K8S:-http://${HOST_GATEWAY}:4566/000000000000/4frames-video-uploads-dlq}"
  export REDIS_URL="${REDIS_URL_K8S:-redis://${HOST_GATEWAY}:6379}"
  export SMTP_HOST="${SMTP_HOST_K8S:-$HOST_GATEWAY}"
  export SMTP_PORT="${SMTP_PORT:-1025}"
  export MAIL_FROM="${MAIL_FROM:-4Frames no-reply@4frames.local}"
  export WEB_APP_URL="${WEB_APP_URL:-http://localhost:5173}"
}

require_tools() {
  for bin in docker kind kubectl envsubst; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "Erro: $bin não encontrado no PATH" >&2
      exit 1
    fi
  done
}

up_infra() {
  echo "Subindo infra no Compose (postgres redis mailpit localstack)"
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres redis mailpit localstack
  echo "Migrations + seed"
  docker compose -f "$ROOT_DIR/docker-compose.yml" run --rm migrate
}

up_cluster() {
  if kind get clusters | grep -qx "$CLUSTER_NAME"; then
    echo "Cluster '$CLUSTER_NAME' já existe — reusando"
  else
    echo "Criando cluster Kind: $CLUSTER_NAME"
    kind create cluster --name "$CLUSTER_NAME" --config "$ROOT_DIR/kind-config.yaml"
  fi
  kubectl config use-context "kind-$CLUSTER_NAME"
}

build_and_load() {
  echo "Buildando $API_IMAGE"
  docker build -t "$API_IMAGE" -f "$ROOT_DIR/apps/api/Dockerfile" "$ROOT_DIR"
  echo "Buildando $WORKER_IMAGE"
  docker build -t "$WORKER_IMAGE" -f "$ROOT_DIR/apps/worker/Dockerfile" "$ROOT_DIR"
  echo "Carregando imagens no Kind"
  kind load docker-image "$API_IMAGE" "$WORKER_IMAGE" --name "$CLUSTER_NAME"
}

install_keda() {
  if ! kubectl get crd scaledobjects.keda.sh >/dev/null 2>&1; then
    echo "Instalando KEDA v${KEDA_VERSION}"
    kubectl apply --server-side -f "https://github.com/kedacore/keda/releases/download/v${KEDA_VERSION}/keda-${KEDA_VERSION}.yaml"
  else
    echo "KEDA já instalado"
  fi

  kubectl wait --for=condition=available --timeout=180s deployment/keda-operator -n keda
  kubectl wait --for=condition=available --timeout=180s deployment/keda-metrics-apiserver -n keda

  # LocalStack não tem IMDS: o scaler SQS do KEDA precisa de credenciais estáticas no operator.
  # (TriggerAuthentication sozinho tenta EC2 metadata e falha no kind + LocalStack.)
  echo "Configurando credenciais AWS no KEDA operator (LocalStack)"
  kubectl set env deployment/keda-operator -n keda \
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    AWS_REGION="${AWS_REGION}" \
    AWS_EC2_METADATA_DISABLED=true
  kubectl rollout status deployment/keda-operator -n keda --timeout=120s
}

apply_app() {
  echo "Aplicando secrets / configmap / deployments"

  envsubst < "$ROOT_DIR/k8s/secret.yaml" | kubectl apply -f -
  envsubst < "$ROOT_DIR/k8s/aws-secret.yaml" | kubectl apply -f -
  envsubst < "$ROOT_DIR/k8s/configmap.yaml" | kubectl apply -f -

  sed "s|IMAGE_PLACEHOLDER|$API_IMAGE|g" "$ROOT_DIR/k8s/api-deployment.yaml" \
    | sed 's|imagePullPolicy: Always|imagePullPolicy: IfNotPresent|g' \
    | kubectl apply -f -

  sed "s|WORKER_IMAGE_PLACEHOLDER|$WORKER_IMAGE|g" "$ROOT_DIR/k8s/worker-deployment.yaml" \
    | sed 's|imagePullPolicy: Always|imagePullPolicy: IfNotPresent|g' \
    | kubectl apply -f -

  kubectl apply -f "$ROOT_DIR/k8s/api-service.yaml"
  kubectl apply -f "$ROOT_DIR/k8s/api-hpa.yaml" || true

  envsubst < "$ROOT_DIR/k8s/keda-trigger-authentication.yaml" | kubectl apply -f -
  envsubst < "$ROOT_DIR/k8s/keda-scaledobject.yaml" | kubectl apply -f -

  echo "Aguardando rollout da API"
  kubectl rollout status deployment/4frames-api --timeout=900s
}

show_validation() {
  cat <<MSG

╭──────────────────────────────────────────────────────────────╮
│  Setup local pronto (padrão garagio-api + KEDA no worker)    │
╰──────────────────────────────────────────────────────────────╯

  API:    http://localhost:31000/health-check
  Docs:   http://localhost:31000/api-docs
  Front:  VITE_API_URL=http://localhost:31000

  # Pods
  kubectl get pods -l 'app in (4frames-api,4frames-worker)'

  # Demo de escala: envie vários vídeos e observe o worker
  kubectl get pods -l app=4frames-worker -w

  # Cleanup
  ./scripts/k8s-local.sh down

MSG
}

cmd_up() {
  load_env
  require_tools
  up_infra
  up_cluster
  build_and_load
  install_keda
  apply_app
  show_validation
}

cmd_down() {
  if kind get clusters | grep -qx "$CLUSTER_NAME"; then
    kind delete cluster --name "$CLUSTER_NAME"
  else
    echo "Cluster '$CLUSTER_NAME' não existe"
  fi
}

cmd_logs() {
  kubectl config use-context "kind-$CLUSTER_NAME"
  echo "=== 4frames-api ==="
  kubectl -n "$NAMESPACE_APP" logs -l app=4frames-api --tail=50 || true
  echo "=== 4frames-worker ==="
  kubectl -n "$NAMESPACE_APP" logs -l app=4frames-worker --tail=50 || true
}

cmd_status() {
  kubectl config use-context "kind-$CLUSTER_NAME"
  kubectl get pods,svc,hpa -n "$NAMESPACE_APP" 2>/dev/null | grep -E '4frames|NAME' || kubectl get pods -n "$NAMESPACE_APP"
  kubectl get scaledobjects.keda.sh -n "$NAMESPACE_APP" 2>/dev/null || true
  kubectl top pods -n "$NAMESPACE_APP" 2>/dev/null || echo '(metrics-server ausente — HPA de CPU pode ficar Pending)'
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  logs)   cmd_logs ;;
  status) cmd_status ;;
  *) echo "Uso: $0 [up|down|logs|status]"; exit 1 ;;
esac
