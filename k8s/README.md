# Manifestos Kubernetes

Mesmo padrão do `garagio-api`: YAML plano, `envsubst`, `IMAGE_PLACEHOLDER`,
script `../scripts/k8s-local.sh` (`up|down|logs|status`).

O provisionamento de cluster em nuvem (se houver) fica fora deste repositório.
Aqui só a **carga** da API e do worker.

| Arquivo | Função |
| ------- | ------ |
| `configmap.yaml` | Env não secreta (`${VAR}` via `envsubst`) |
| `secret.yaml` | DB + JWT |
| `aws-secret.yaml` | Credenciais AWS / LocalStack |
| `api-deployment.yaml` | Deployment da API (`IMAGE_PLACEHOLDER`) |
| `api-service.yaml` | NodePort `31000` (`frames-api-service` — nome não pode começar com dígito) |
| `api-hpa.yaml` | HPA CPU/memória |
| `worker-deployment.yaml` | Worker (`WORKER_IMAGE_PLACEHOLDER`), 1 vídeo/réplica |
| `keda-trigger-authentication.yaml` | Auth do scaler SQS |
| `keda-scaledobject.yaml` | Auto-scale do worker pela fila |

## Local (kind)

### Subir

```bash
cp .env.example .env   # se ainda não tiver
./scripts/k8s-local.sh up
```

- Infra (Postgres, Redis, LocalStack, Mailpit) sobe no **Compose** no host.
- Pare `api`/`worker`/`notifier` do Compose se estiverem no ar (mesma fila SQS):
  `docker compose stop api worker notifier`.
- API: `http://localhost:31000`
- Front (`4frames-web-app`): `VITE_API_URL=http://localhost:31000` e `pnpm dev`

### Testar

```bash
curl -s http://localhost:31000/health-check
curl -s -X POST http://localhost:31000/auth \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@admin.com","password":"123456"}'

./scripts/k8s-local.sh status
kubectl get pods -l app=4frames-worker -w   # demo de escala ao enfileirar vídeos
```

No front: login → converter vários vídeos → Meus vídeos → download quando `DONE`.

### Desligar

```bash
./scripts/k8s-local.sh down
docker compose stop    # opcional
```

## Linux / kind e LocalStack

- Pods alcançam o Compose no host pelo **gateway da rede `kind`** (o script detecta
  automaticamente; não depende de `host.docker.internal`).
- `S3_PUBLIC_ENDPOINT_URL` continua `http://localhost:4566` (navegador).
- O KEDA operator recebe `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` via `kubectl set env`
  no `up` — o scaler SQS tenta IMDS e falha no LocalStack sem isso.
- Overrides manuais: `DB_HOST_K8S`, `AWS_ENDPOINT_URL_K8S`, `SQS_QUEUE_URL_K8S`, `REDIS_URL_K8S`.
