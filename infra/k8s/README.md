# Kubernetes (manifestos do core-api)

Manifestos Kustomize dos Deployments `api`, `worker` e `notifier`. Postgres, Redis,
LocalStack e Mailpit ficam fora deste overlay por enquanto (Compose no desenvolvimento;
cluster completo entra em cards posteriores). O smoke do CD prova só que as imagens
publicadas sobem e respondem health.

## Layout

```text
infra/k8s/
  base/                 # recursos compartilhados (imagem :local)
  overlays/local/       # cluster local: aponta para GHCR (troque a tag)
  overlays/ci/          # Kind no GitHub Actions (imagens carregadas no nó)
```

## Validar (sem cluster)

```bash
kubectl kustomize infra/k8s/overlays/local | kubeconform -strict -summary
# ou, sem kubeconform:
kubectl kustomize infra/k8s/overlays/local >/dev/null
kubectl apply --dry-run=client -f <(kubectl kustomize infra/k8s/overlays/local)
```

## Deploy de uma tag `release-*` no cluster local

Mesmos manifestos do base; só mudam as tags das imagens no overlay `local`.

1. Crie o cluster (ex.: Kind) e aponte o `kubectl`:

```bash
kind create cluster --name 4frames
```

2. Se o repositório GHCR for privado, autentique o cluster (uma vez):

```bash
# Crie um PAT com read:packages e importe como imagePullSecret, ou faça:
docker login ghcr.io -u USERNAME -p TOKEN
# e, se precisar pull no nó do Kind, use kind load (passo 3b) em vez de pull.
```

3. Aplique a tag desejada (substitua `release-0.1.0`):

```bash
TAG=release-0.1.0
OWNER=tech-challenge-41   # dono do GHCR; ajuste se o fork usar outro

cd infra/k8s/overlays/local
kustomize edit set image \
  4frames-api=ghcr.io/${OWNER}/4frames-api:${TAG} \
  4frames-worker=ghcr.io/${OWNER}/4frames-worker:${TAG} \
  4frames-notifier=ghcr.io/${OWNER}/4frames-notifier:${TAG}
cd -

# Alternativa sem editar o arquivo: carregue imagens locais no Kind
# (útil quando o GHCR ainda não está público):
#   docker pull ghcr.io/${OWNER}/4frames-api:${TAG}
#   kind load docker-image ghcr.io/${OWNER}/4frames-api:${TAG} --name 4frames
#   ... idem worker e notifier ...
```

4. Deploy e smoke:

```bash
kubectl apply -k infra/k8s/overlays/local
kubectl -n 4frames rollout status deploy/api --timeout=180s
kubectl -n 4frames rollout status deploy/worker --timeout=180s
kubectl -n 4frames rollout status deploy/notifier --timeout=180s

kubectl -n 4frames port-forward svc/api 3000:3000 &
kubectl -n 4frames port-forward svc/worker 9100:9100 &
curl -fsS http://127.0.0.1:3000/health-check
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9100/healthz
kubectl -n 4frames get pods
```

5. Desfaça a edição local do overlay antes de commitar (`git checkout -- infra/k8s/overlays/local/kustomization.yaml`),
   ou deixe a tag fixa só na sua máquina.

Os Secrets do base usam valores de desenvolvimento (iguais ao `.env.example`). Não use em produção.
