#!/usr/bin/env bash
#
# Sobe o 4Frames num cluster Kind local (ADR-002):
#   - Manifestos: overlay Kustomize infra/k8s/overlays/local (D10)
#   - Infra (Postgres, Redis, LocalStack, Mailpit) no Compose do host
#   - API com HPA; worker escalado pelo KEDA pela profundidade da fila SQS
#
# Pré-requisitos: docker, kind, kubectl (.env na raiz)
#
# Uso:
#   ./scripts/k8s-local.sh up       # infra, cluster, imagens, KEDA e deploy
#   ./scripts/k8s-local.sh status
#   ./scripts/k8s-local.sh logs
#   ./scripts/k8s-local.sh down     # apaga o cluster (a infra do Compose continua de pé)
#
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-4frames-local}"
KEDA_VERSION="${KEDA_VERSION:-2.16.1}"
NAMESPACE="4frames"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIND_CONFIG="$ROOT_DIR/infra/k8s/kind-config.yaml"
OVERLAY_DIR="$ROOT_DIR/infra/k8s/overlays/local"
# Mesma tag do infra/k8s/base (newTag: local): as imagens são construídas aqui e carregadas no nó.
APPS=(api worker notifier)

# No Linux, kind não popula host.docker.internal. Usa o gateway da rede `kind`
# (alcança portas publicadas no host: Postgres, Redis, LocalStack, Mailpit).
# A rede só existe depois do primeiro `kind create cluster`. KIND_HOST_GATEWAY força um valor.
detect_host_gateway() {
  if [[ -n "${KIND_HOST_GATEWAY:-}" ]]; then
    echo "$KIND_HOST_GATEWAY"
    return
  fi
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
  # tr: um .env salvo com CRLF no Windows deixaria \r no fim de cada valor.
  # shellcheck disable=SC1090
  source <(tr -d '\r' < "$ROOT_DIR/.env")
  set +a

  # Mesmos padrões do .env.example.
  DB_USERNAME="${DB_USERNAME:-admin}"
  DB_PASSWORD="${DB_PASSWORD:-123456}"
  DB_DATABASE="${DB_DATABASE:-4frames_core}"
  JWT_SECRET_KEY="${JWT_SECRET_KEY:-change_me}"
  AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
  AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
  AWS_REGION="${AWS_REGION:-us-east-1}"
}

require_tools() {
  for bin in docker kind kubectl; do
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

  if [[ -n "$(docker compose -f "$ROOT_DIR/docker-compose.yml" ps -q api worker notifier 2>/dev/null)" ]]; then
    echo "Aviso: api/worker/notifier do Compose estão no ar e disputam a mesma fila com o cluster." >&2
    echo "       Pare-os com: docker compose stop api worker notifier" >&2
  fi
}

up_cluster() {
  if kind get clusters | grep -qx "$CLUSTER_NAME"; then
    echo "Cluster '$CLUSTER_NAME' já existe — reusando"
  else
    echo "Criando cluster Kind: $CLUSTER_NAME"
    kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
  fi
  kubectl config use-context "kind-$CLUSTER_NAME"
}

build_and_load() {
  local images=()
  for app in "${APPS[@]}"; do
    echo "Buildando 4frames-$app:local"
    docker build -t "4frames-$app:local" -f "$ROOT_DIR/apps/$app/Dockerfile" "$ROOT_DIR"
    images+=("4frames-$app:local")
  done
  echo "Carregando imagens no Kind"
  kind load docker-image "${images[@]}" --name "$CLUSTER_NAME"
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
  # O webhook valida o ScaledObject no apply: precisa estar de pé antes do deploy.
  kubectl wait --for=condition=available --timeout=180s deployment/keda-admission -n keda

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
  local gateway="$1"

  kubectl apply -f "$ROOT_DIR/infra/k8s/base/namespace.yaml"

  # Secret a partir do .env: as mesmas credenciais com que o Compose sobe o Postgres. O overlay local
  # não traz o Secret do base, então o apply abaixo não o sobrescreve. DB_USERNAME e DB_DATABASE
  # também estão no ConfigMap; o secretRef vem depois no envFrom e vale o do Secret.
  echo "Gerando o Secret 4frames-secret a partir do .env"
  kubectl -n "$NAMESPACE" create secret generic 4frames-secret \
    --from-literal=DB_USERNAME="$DB_USERNAME" \
    --from-literal=DB_PASSWORD="$DB_PASSWORD" \
    --from-literal=DB_DATABASE="$DB_DATABASE" \
    --from-literal=JWT_SECRET_KEY="$JWT_SECRET_KEY" \
    --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -

  echo "Aplicando o overlay local (infra do Compose em $gateway)"
  kubectl kustomize "$OVERLAY_DIR" | sed "s/host\.docker\.internal/${gateway}/g" | kubectl apply -f -

  echo "Aguardando os rollouts"
  for app in "${APPS[@]}"; do
    kubectl -n "$NAMESPACE" rollout status "deployment/$app" --timeout=300s
  done
}

show_validation() {
  cat <<MSG

╭──────────────────────────────────────────────────────────────╮
│  Setup local pronto                                          │
╰──────────────────────────────────────────────────────────────╯

  API:     http://localhost:31000/health-check
  Docs:    http://localhost:31000/api-docs
  Front:   VITE_API_URL=http://localhost:31000 pnpm dev (no 4frames-web-app)
  Mailpit: http://localhost:8025

  # Pods, HPA e ScaledObject
  ./scripts/k8s-local.sh status

  # Demo de escala: envie vários vídeos e observe o worker
  kubectl -n ${NAMESPACE} get pods -l app.kubernetes.io/name=worker -w

  # Cleanup
  ./scripts/k8s-local.sh down

MSG
}

cmd_up() {
  load_env
  require_tools
  up_infra
  up_cluster
  local gateway
  gateway="$(detect_host_gateway)"
  echo "Host gateway para pods: $gateway"
  build_and_load
  install_keda
  apply_app "$gateway"
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
  for app in "${APPS[@]}"; do
    echo "=== $app ==="
    kubectl -n "$NAMESPACE" logs -l "app.kubernetes.io/name=$app" --tail=50 || true
  done
}

cmd_status() {
  kubectl config use-context "kind-$CLUSTER_NAME"
  kubectl -n "$NAMESPACE" get pods,svc,hpa
  kubectl -n "$NAMESPACE" get scaledobjects.keda.sh 2>/dev/null || true
  kubectl -n "$NAMESPACE" top pods 2>/dev/null \
    || echo '(metrics-server ausente — o HPA fica sem métrica de CPU e só garante o mínimo de réplicas)'
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  logs)   cmd_logs ;;
  status) cmd_status ;;
  *) echo "Uso: $0 [up|down|logs|status]"; exit 1 ;;
esac
