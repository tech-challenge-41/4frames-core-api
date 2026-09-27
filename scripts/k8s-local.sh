#!/usr/bin/env bash
#
# Sobe o 4Frames num cluster Kind local (ADR-002):
#   - Manifestos: overlay Kustomize infra/k8s/overlays/local (D10)
#   - Infra (Postgres, Redis, LocalStack, Mailpit) no Compose do host
#   - Migrations e seed num Job do cluster, antes dos apps
#   - Front em http://localhost:8080 e API com HPA (metrics-server) em /api, atrás do Ingress (ingress-nginx)
#   - Worker escalado pelo KEDA pela profundidade da fila SQS
#
# Pré-requisitos: docker, kind, kubectl (.env na raiz) e o 4frames-web-app clonado ao lado deste repositório
# (WEB_APP_DIR aponta para outro lugar)
#
# Uso:
#   ./scripts/k8s-local.sh up       # infra, cluster, imagens, KEDA, migrations e deploy
#   ./scripts/k8s-local.sh status
#   ./scripts/k8s-local.sh logs
#   ./scripts/k8s-local.sh down     # apaga o cluster (a infra do Compose continua de pé)
#
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-4frames-local}"
KEDA_VERSION="${KEDA_VERSION:-2.16.1}"
METRICS_SERVER_VERSION="${METRICS_SERVER_VERSION:-0.9.0}"
# O projeto ingress-nginx foi arquivado: 1.15.1 é a última versão publicada.
INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-1.15.1}"
NAMESPACE="4frames"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIND_CONFIG="$ROOT_DIR/infra/k8s/kind-config.yaml"
OVERLAY_DIR="$ROOT_DIR/infra/k8s/overlays/local"
# O front mora em outro repositório: a imagem web é construída a partir do clone dele.
WEB_APP_DIR="${WEB_APP_DIR:-$ROOT_DIR/../4frames-web-app}"
# Mesma tag do infra/k8s/base (newTag: local): as imagens são construídas aqui e carregadas no nó.
# APPS são os Deployments; a imagem migrate é do Job de migrations e seed.
APPS=(api worker notifier web)
IMAGES=(api worker notifier web migrate)
# Deployments que leem o ConfigMap e o Secret por envFrom. As variáveis só valem para pods novos.
CONFIG_APPS=(api worker notifier)
# Preenchido pelo build: apps cuja imagem mudou e precisam de rollout restart.
CHANGED_APPS=()
# Preenchido pelo deploy: 1 quando o apply alterou o ConfigMap ou o Secret.
CONFIG_CHANGED=0

dockerfile_for() {
  case "$1" in
    migrate) echo "$ROOT_DIR/packages/shared/Dockerfile" ;;
    web) echo "$WEB_APP_DIR/Dockerfile" ;;
    *) echo "$ROOT_DIR/apps/$1/Dockerfile" ;;
  esac
}

# As imagens do monorepo usam a raiz como contexto; a do front, a raiz do 4frames-web-app.
context_for() {
  case "$1" in
    web) echo "$WEB_APP_DIR" ;;
    *) echo "$ROOT_DIR" ;;
  esac
}

# No Linux, kind não popula host.docker.internal. Usa o gateway da rede `kind`
# (alcança portas publicadas no host: Postgres, Redis, LocalStack, Mailpit).
# A rede só existe depois do primeiro `kind create cluster`. KIND_HOST_GATEWAY força um valor.
detect_host_gateway() {
  if [[ -n "${KIND_HOST_GATEWAY:-}" ]]; then
    echo "$KIND_HOST_GATEWAY"
    return
  fi
  local gw
  # A rede tem uma sub-rede IPv4 e outra IPv6, em qualquer ordem. Só serve o gateway IPv4: um IPv6
  # sem colchetes quebra as URLs do ConfigMap (http://gateway:4566, redis://gateway:6379).
  gw="$(docker network inspect kind -f '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null \
    | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -n 1 || true)"
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

# Sem o clone do front, o Deployment web ficaria sem imagem e o up só falharia no fim, no rollout.
require_web_app() {
  if [[ ! -f "$WEB_APP_DIR/Dockerfile" ]]; then
    echo "Erro: $WEB_APP_DIR/Dockerfile não encontrado." >&2
    echo "      Clone o 4frames-web-app ao lado do 4frames-core-api, numa branch com o Dockerfile (develop)," >&2
    echo "      ou aponte WEB_APP_DIR para o clone." >&2
    exit 1
  fi
  WEB_APP_DIR="$(cd "$WEB_APP_DIR" && pwd)"
}

up_infra() {
  echo "Subindo infra no Compose (postgres redis mailpit localstack)"
  # --wait: o Job de migrations precisa do Postgres saudável, e os apps, do LocalStack com filas e bucket.
  # As migrations rodam no cluster (Job migrate); o serviço migrate do Compose fica para o desenvolvimento.
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d --wait postgres redis mailpit localstack

  if [[ -n "$(docker compose -f "$ROOT_DIR/docker-compose.yml" ps -q api worker notifier 2>/dev/null)" ]]; then
    echo "Aviso: api/worker/notifier do Compose estão no ar e disputam a mesma fila com o cluster." >&2
    echo "       Pare-os com: docker compose stop api worker notifier" >&2
  fi
}

up_cluster() {
  if kind get clusters | grep -qx "$CLUSTER_NAME"; then
    echo "Cluster '$CLUSTER_NAME' já existe — reusando"
    # Sem a porta do Ingress publicada, o cluster é de antes dela no kind-config.yaml ou voltou de um
    # reinício do Docker Desktop, que devolve o nó sem nenhuma porta. Nos dois casos, só recriar resolve.
    if ! docker port "${CLUSTER_NAME}-control-plane" 80/tcp >/dev/null 2>&1; then
      echo "Erro: o nó de '$CLUSTER_NAME' está sem a porta do Ingress publicada no host." >&2
      echo "      Recrie o cluster: ./scripts/k8s-local.sh down && ./scripts/k8s-local.sh up" >&2
      exit 1
    fi
  else
    echo "Criando cluster Kind: $CLUSTER_NAME"
    kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
  fi
  kubectl config use-context "kind-$CLUSTER_NAME"
}

build_and_load() {
  local images=() before after
  for app in "${IMAGES[@]}"; do
    before="$(docker image inspect -f '{{.Id}}' "4frames-$app:local" 2>/dev/null || true)"
    echo "Buildando 4frames-$app:local"
    # --provenance=false: a atestação de proveniência leva timestamp e mudaria o ID a cada build, mesmo com
    # tudo em cache. Com o ID estável, o `kind load` pula imagens que o nó já tem e só reinicia o que mudou.
    docker build --provenance=false -t "4frames-$app:local" -f "$(dockerfile_for "$app")" "$(context_for "$app")"
    after="$(docker image inspect -f '{{.Id}}' "4frames-$app:local")"
    # O Job migrate é recriado a cada deploy; só os Deployments precisam de restart.
    if [[ "$before" != "$after" && "$app" != "migrate" ]]; then
      CHANGED_APPS+=("$app")
    fi
    images+=("4frames-$app:local")
  done
  echo "Carregando imagens no Kind"
  kind load docker-image "${images[@]}" --name "$CLUSTER_NAME"
}

install_metrics_server() {
  echo "Instalando metrics-server v${METRICS_SERVER_VERSION}"
  kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/v${METRICS_SERVER_VERSION}/components.yaml"

  # O Kind não assina os certificados do kubelet com a CA do cluster: sem esta flag o metrics-server
  # recusa a conexão com o kubelet e o HPA fica sem métrica de CPU.
  if ! kubectl -n kube-system get deployment metrics-server \
    -o jsonpath='{.spec.template.spec.containers[0].args}' | grep -q -- '--kubelet-insecure-tls'; then
    kubectl -n kube-system patch deployment metrics-server --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
  fi
  kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s

  # A primeira coleta leva perto de um minuto; até lá o HPA não enxerga a CPU.
  echo "Aguardando o metrics-server responder (kubectl top nodes)"
  for _ in $(seq 1 60); do
    if kubectl top nodes >/dev/null 2>&1; then
      kubectl top nodes
      return
    fi
    sleep 5
  done
  echo "Erro: o metrics-server não respondeu em 5 minutos (kubectl -n kube-system logs deploy/metrics-server)" >&2
  exit 1
}

install_ingress_nginx() {
  echo "Instalando ingress-nginx controller-v${INGRESS_NGINX_VERSION}"
  # Manifesto para kind: o controller escuta nas portas 80 e 443 do nó, publicadas pelo kind-config.yaml.
  kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v${INGRESS_NGINX_VERSION}/deploy/static/provider/kind/deploy.yaml"

  # O SSE leva o JWT em ?token= (o EventSource não envia header): o log de acesso grava o caminho sem a query
  # string. É o formato padrão do ingress-nginx com "$request" trocado por método, $uri e protocolo.
  kubectl -n ingress-nginx patch configmap ingress-nginx-controller --type merge -p "$(cat <<'JSON'
{"data":{"log-format-upstream":"$remote_addr - $remote_user [$time_local] \"$request_method $uri $server_protocol\" $status $body_bytes_sent \"$http_referer\" \"$http_user_agent\" $request_length $request_time [$proxy_upstream_name] [$proxy_alternative_upstream_name] $upstream_addr $upstream_response_length $upstream_response_time $upstream_status $req_id"}}
JSON
)"
  kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=180s
}

install_keda() {
  if ! kubectl get crd scaledobjects.keda.sh >/dev/null 2>&1; then
    echo "Instalando KEDA v${KEDA_VERSION}"
    kubectl apply --server-side -f "https://github.com/kedacore/keda/releases/download/v${KEDA_VERSION}/keda-${KEDA_VERSION}.yaml"
  else
    echo "KEDA já instalado"
  fi

  # 300 s: num cluster recém-criado as imagens do KEDA vêm do ghcr.io, e o pull já levou quase 3 minutos.
  kubectl wait --for=condition=available --timeout=300s deployment/keda-operator -n keda
  kubectl wait --for=condition=available --timeout=300s deployment/keda-metrics-apiserver -n keda
  # O webhook valida o ScaledObject no apply: precisa estar de pé antes do deploy.
  kubectl wait --for=condition=available --timeout=300s deployment/keda-admission -n keda

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

# O `kubectl apply` imprime "configured" para o objeto que mudou; "unchanged" e "created" não pedem restart.
note_config_change() {
  if grep -qE '^(configmap/4frames-config|secret/4frames-secret) configured$' <<<"$1"; then
    CONFIG_CHANGED=1
  fi
}

apply_app() {
  local gateway="$1"

  kubectl apply -f "$ROOT_DIR/infra/k8s/base/namespace.yaml"

  # Secret a partir do .env: as mesmas credenciais com que o Compose sobe o Postgres. O overlay local
  # não traz o Secret do base, então o apply abaixo não o sobrescreve. DB_USERNAME e DB_DATABASE
  # também estão no ConfigMap; o secretRef vem depois no envFrom e vale o do Secret.
  echo "Gerando o Secret 4frames-secret a partir do .env"
  local applied
  applied="$(kubectl -n "$NAMESPACE" create secret generic 4frames-secret \
    --from-literal=DB_USERNAME="$DB_USERNAME" \
    --from-literal=DB_PASSWORD="$DB_PASSWORD" \
    --from-literal=DB_DATABASE="$DB_DATABASE" \
    --from-literal=JWT_SECRET_KEY="$JWT_SECRET_KEY" \
    --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -)"
  echo "$applied"
  note_config_change "$applied"

  # O spec.template de um Job é imutável: o Job migrate é apagado e recriado a cada deploy. Rodar de novo é
  # seguro, porque o migrate deploy só aplica o que falta e o seed usa upsert.
  kubectl -n "$NAMESPACE" delete job migrate --ignore-not-found

  echo "Aplicando o overlay local (infra do Compose em $gateway)"
  local manifests
  manifests="$(kubectl kustomize "$OVERLAY_DIR" | sed "s/host\.docker\.internal/${gateway}/g")"
  # Os webhooks de admissão do KEDA e do ingress-nginx podem recusar chamadas por alguns segundos depois
  # que os pods ficam prontos, enquanto o certificado é injetado. O apply é idempotente: tenta de novo.
  for attempt in 1 2 3 4 5; do
    # Uma tentativa que falha pode ter aplicado o ConfigMap: a mudança é anotada em todas.
    if applied="$(kubectl apply -f - <<<"$manifests")"; then
      echo "$applied"
      note_config_change "$applied"
      break
    fi
    echo "$applied"
    note_config_change "$applied"
    if [[ "$attempt" -eq 5 ]]; then
      echo "Erro: o overlay não foi aplicado depois de 5 tentativas" >&2
      exit 1
    fi
    echo "apply falhou; nova tentativa em 5 s ($attempt/5)"
    sleep 5
  done

  echo "Aguardando o Job de migrations e seed"
  if ! kubectl -n "$NAMESPACE" wait --for=condition=complete job/migrate --timeout=300s; then
    kubectl -n "$NAMESPACE" logs job/migrate --tail=60 >&2 || true
    echo "Erro: o Job migrate não terminou (kubectl -n $NAMESPACE describe job migrate)" >&2
    exit 1
  fi

  # A tag é sempre :local: se o manifesto não mudou, o Deployment não troca de pod sozinho e seguiria com o
  # código antigo. Reinicia quem teve a imagem reconstruída e, se o ConfigMap ou o Secret mudaram, os apps que
  # os leem: sem isso, um valor novo (ex.: WEB_APP_URL) não chegaria aos pods que já estão rodando.
  local restart=(${CHANGED_APPS[@]+"${CHANGED_APPS[@]}"})
  if [[ "$CONFIG_CHANGED" -eq 1 ]]; then
    echo "ConfigMap ou Secret mudaram: ${CONFIG_APPS[*]} serão reiniciados"
    restart+=("${CONFIG_APPS[@]}")
  fi
  for app in $(printf '%s\n' ${restart[@]+"${restart[@]}"} | sort -u); do
    echo "Reiniciando o Deployment $app"
    kubectl -n "$NAMESPACE" rollout restart "deployment/$app"
  done

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

  Front:   http://localhost:8080 (pelo Ingress)
  API:     http://localhost:8080/api/health-check
  Docs:    http://localhost:8080/api/api-docs/
  Mailpit: http://localhost:8025

  # Pods, Ingress, HPA e ScaledObject
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
  require_web_app
  up_infra
  up_cluster
  local gateway
  gateway="$(detect_host_gateway)"
  echo "Host gateway para pods: $gateway"
  build_and_load
  install_metrics_server
  install_ingress_nginx
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
  for app in "${APPS[@]}" migrate; do
    echo "=== $app ==="
    kubectl -n "$NAMESPACE" logs -l "app.kubernetes.io/name=$app" --tail=50 || true
  done
}

cmd_status() {
  kubectl config use-context "kind-$CLUSTER_NAME"
  kubectl -n "$NAMESPACE" get pods,jobs,svc,ingress,hpa
  kubectl -n "$NAMESPACE" get scaledobjects.keda.sh 2>/dev/null || true
  kubectl -n "$NAMESPACE" top pods 2>/dev/null \
    || echo '(metrics-server sem dados ainda: a primeira coleta leva perto de um minuto)'
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  logs)   cmd_logs ;;
  status) cmd_status ;;
  *) echo "Uso: $0 [up|down|logs|status]"; exit 1 ;;
esac
