# Kubernetes (manifestos do core-api)

Manifestos Kustomize da stack no cluster. Todo o Kubernetes do repositório mora aqui (D10). Postgres,
Redis, LocalStack e Mailpit ficam fora do cluster, no Compose, como os serviços gerenciados ficavam fora do
EKS no ADR-001 (ver ADR-002).

## Layout

```text
infra/k8s/
  kind-config.yaml   # cluster Kind local: publica no host a porta 31000 da API
  base/              # namespace 4frames, ConfigMap, Secret de desenvolvimento e os três Deployments
  overlays/local/    # Kind local: infra do Compose no host, API em NodePort 31000, Secret gerado do .env
  overlays/ci/       # Kind efêmero do CD: imagens :ci e um Redis para o notifier
```

| App      | Arquivos do `base`                                                                                               | Escala                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| api      | `api-deployment.yaml`, `api-service.yaml`, `api-hpa.yaml`                                                        | HPA por CPU (70 %), de 2 a 4 réplicas                       |
| worker   | `worker-deployment.yaml`, `worker-service.yaml`, `worker-scaledobject.yaml`, `worker-triggerauthentication.yaml` | KEDA pela fila SQS, de 1 a 5 réplicas, um vídeo por réplica |
| notifier | `notifier-deployment.yaml`                                                                                       | 1 réplica (o claim em `notified_at` permite mais)           |

`api` e `worker` não fixam `replicas`: quem decide são o HPA e o KEDA. Worker e notifier têm liveness e
readiness em `GET /healthz` na porta 9100; a API, em `GET /health-check`.

## Cluster local (Kind)

Pré-requisitos: Docker, [kind](https://kind.sigs.k8s.io/), `kubectl` e o `.env` na raiz (`cp .env.example .env`).

```bash
./scripts/k8s-local.sh up
```

O script, em ordem:

1. Sobe a infra no Compose (`postgres redis mailpit localstack`) e roda migrations e seed.
2. Cria o cluster `4frames-local` com `infra/k8s/kind-config.yaml`, ou reusa o que já existe.
3. Detecta o gateway da rede `kind`, que é por onde os pods alcançam as portas publicadas no host. No Linux o
   Kind não resolve `host.docker.internal`. `KIND_HOST_GATEWAY` força outro endereço.
4. Constrói `4frames-api:local`, `4frames-worker:local` e `4frames-notifier:local` e carrega as três no nó.
5. Instala o KEDA com versão fixada (`KEDA_VERSION`, padrão `2.16.1`) e grava as credenciais do LocalStack no
   operator: sem elas, o scaler SQS tenta o IMDS da EC2 e falha.
6. Gera o Secret `4frames-secret` a partir do `.env`, com as mesmas credenciais com que o Compose sobe o
   Postgres. O overlay local não traz o Secret do `base`, então o deploy não o sobrescreve.
7. Renderiza `overlays/local`, troca `host.docker.internal` pelo gateway detectado, aplica e espera os rollouts.

| O quê   | Onde                                                                                         |
| ------- | -------------------------------------------------------------------------------------------- |
| API     | http://localhost:31000/health-check e http://localhost:31000/api-docs                        |
| Front   | No `4frames-web-app`: `VITE_API_URL=http://localhost:31000 pnpm dev` → http://localhost:5173 |
| E-mails | Mailpit do Compose, http://localhost:8025                                                    |

```bash
./scripts/k8s-local.sh status                                  # pods, services, HPA e ScaledObject
./scripts/k8s-local.sh logs                                    # últimas linhas de api, worker e notifier
kubectl -n 4frames get pods -l app.kubernetes.io/name=worker -w   # KEDA subindo workers com a fila cheia
./scripts/k8s-local.sh down                                    # apaga o cluster; a infra do Compose continua
```

- Não deixe `api`, `worker` e `notifier` do Compose no ar junto com o cluster: disputam a mesma fila. O script
  avisa; pare-os com `docker compose stop api worker notifier`.
- `S3_PUBLIC_ENDPOINT_URL` continua `http://localhost:4566`: quem abre a URL assinada é o navegador.
- Depois de mudar o `.env`, rode `up` de novo e `kubectl -n 4frames rollout restart deploy`: o Secret novo só
  vale para pods novos.
- O script ainda não instala o metrics-server. Sem ele o HPA fica sem métrica de CPU e só garante o mínimo de
  réplicas.
- O build e o `kind load` ocupam bastante disco. Se o `kind load` falhar com _no space left_, rode
  `docker system prune -af` (remove imagens não usadas) e tente de novo.

## Validar sem cluster

```bash
kubectl kustomize infra/k8s/overlays/local >/dev/null
kubectl kustomize infra/k8s/overlays/ci >/dev/null
```

O job `validate-k8s` do CI renderiza os dois overlays e valida com `kubeconform -strict`, usando o catálogo
de schemas da Datree para os CRDs do KEDA:

```bash
kubectl kustomize infra/k8s/overlays/local | kubeconform -strict -summary \
  -schema-location default \
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
```

## CD (overlay `ci`)

A cada tag `release-*`, o `cd.yml` constrói e publica as imagens no GHCR, cria um Kind efêmero, carrega as
imagens, instala o KEDA e aplica `overlays/ci`. O overlay acrescenta um Redis dentro do cluster, porque o
notifier só fica pronto com a assinatura de `jobs.events` ativa. Postgres e LocalStack não existem nesse
cluster: o smoke prova que as imagens sobem e respondem saúde (`/health-check` da API, `/healthz` do worker e
rollout do notifier), não o fluxo de vídeo.

## Deploy de uma tag `release-*` no cluster local

Mesmos manifestos; só a imagem muda. Com o cluster no ar (`./scripts/k8s-local.sh up`) e, como os pacotes do
GHCR são privados, `docker login ghcr.io` com um PAT `read:packages`:

```bash
TAG=release-0.1.0
OWNER=tech-challenge-41

for app in api worker notifier; do
  docker pull "ghcr.io/${OWNER}/4frames-${app}:${TAG}"
  docker tag "ghcr.io/${OWNER}/4frames-${app}:${TAG}" "4frames-${app}:local"
done
kind load docker-image 4frames-api:local 4frames-worker:local 4frames-notifier:local --name 4frames-local
kubectl -n 4frames rollout restart deploy/api deploy/worker deploy/notifier
```

O `base/secret.yaml` tem valores de desenvolvimento (iguais ao `.env.example`), usados só pelo overlay `ci`.
Não use em produção.
