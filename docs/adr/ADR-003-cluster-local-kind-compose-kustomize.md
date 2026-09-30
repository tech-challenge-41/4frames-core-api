# ADR-003: Cluster local com Kind, infraestrutura no Docker Compose e manifestos com Kustomize

## Status

Aceito. Registra as escolhas que o [ADR-002](./ADR-002-execucao-local-e-monorepo.md) (seção 2.2) deixou para quem
implementasse o cluster.

## Data

2026-09-24. O cluster Kind entrou em 2026-09-23 e foi consolidado com o Kustomize em `infra/k8s/` em 2026-09-24.
Ingress, metrics-server e o Job de migrations entraram em 2026-09-25; o front atrás do Ingress, o comando único e o
CronJob de expiração, em 2026-09-27. Registrado em 2026-09-28.

## 1. Contexto

O ADR-002 manteve o Kubernetes num cluster local e deixou três escolhas em aberto: a distribuição do cluster, onde rodam
Postgres, Redis, LocalStack e Mailpit, e o formato dos manifestos. Ele também não dizia como o front chega ao cluster,
como o banco ganha schema sem o Compose, onde roda a rotina de expiração nem como alguém de fora sobe tudo.

Restrições que pesaram:

- Quem avalia precisa subir a solução numa máquina com Docker, sem conta de nuvem, com o mínimo de ferramentas.
- O CD precisa de um cluster efêmero no GitHub Actions, de preferência com a mesma ferramenta do cluster local.
- O Compose de desenvolvimento já sobe Postgres, Redis, LocalStack (com bucket, filas e notificação) e Mailpit.
- Duas árvores de manifestos chegaram em PRs paralelas, uma com Kustomize em `infra/k8s/` e outra com YAML plano em
  `k8s/`, sem caminho em comum. O git mesclaria as duas em silêncio.

## 2. Decisão

### 2.1. Kind como distribuição

O cluster local é um Kind de um nó, `4frames-local`, criado com `infra/k8s/kind-config.yaml`. As portas 80 e 443 do
Ingress ficam publicadas no host em **8080** e **8443**; no Windows, a porta 80 costuma estar ocupada pelo `http.sys`.

- O Kind tem action oficial (`helm/kind-action`), e o CD usa a mesma ferramenta num cluster efêmero.
- `kind load docker-image` leva as imagens construídas localmente para o nó. O cluster não depende de registry, nem
  do GHCR, cujos pacotes são privados.
- O Kind não traz Ingress controller nem metrics-server. Os dois são instalados pelo script, com versão fixada.

### 2.2. Infraestrutura fora do cluster, no Docker Compose

Postgres 16, Redis 7, LocalStack (S3 e SQS) e Mailpit rodam no Compose de desenvolvimento, fora do cluster, como os
serviços gerenciados ficavam fora do EKS no ADR-001. O cluster roda só o que é da solução: API, worker, notificador,
front, migrations e rotina de expiração.

- Os pods alcançam o host pelo gateway IPv4 da rede `kind`, que o script detecta. No Linux o Kind não resolve
  `host.docker.internal`. `KIND_HOST_GATEWAY` força outro endereço.
- O navegador alcança o LocalStack em `localhost:4566`, o endereço com que a API assina as URLs
  (`S3_PUBLIC_ENDPOINT_URL`).
- O **Mailpit é o SMTP padrão**: o `.env.example` e o Compose apontam para ele. Um provedor externo deixaria um clone
  limpo sem e-mail e exigiria conta de terceiro para a demonstração.

### 2.3. Kustomize, num único lugar: `infra/k8s/`

Todo o Kubernetes do repositório mora em `infra/k8s/`, com um `base` e dois overlays. A árvore `k8s/` da raiz foi
reescrita dentro dela antes do merge.

| Overlay          | Para quê           | O que muda em relação ao `base`                                                                                                                                                                                                                             |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlays/local` | Kind local         | Endereços da infra no host (Postgres, Redis, LocalStack, Mailpit e o host da fila do KEDA), `CORS_ORIGIN` com o front em dev, e o Secret gerado do `.env` pelo script (o do `base` sai)                                                                     |
| `overlays/ci`    | Kind efêmero do CD | Imagens com a tag da release e um Redis no cluster para o notificador. Saem o Job de migrations, o CronJob de expiração e o front, e a readiness da API volta a `/health-check`: não há Postgres nem LocalStack, e a imagem do front é de outro repositório |

- O Kustomize vem no `kubectl` e dispensa instalação. Os dois ambientes diferem em poucos campos, e patches cobrem isso
  sem templating.
- O CI renderiza os dois overlays e valida com `kubeconform -strict`, com os CRDs do KEDA pelo catálogo da Datree.

### 2.4. Front e API na mesma origem, atrás do Ingress

O ingress-nginx para Kind (1.15.1) atende em `http://localhost:8080`, com dois recursos Ingress:

- `4frames`: `/api(/|$)(.*)` → API, sem o prefixo (`rewrite-target`). As anotações do SSE (`proxy-buffering: off` e
  timeouts de 3600 s) entregam cada evento na hora.
- `4frames-web`: `/` → front. O `rewrite-target` vale para todos os paths de um Ingress, e o caminho do front precisa
  chegar inteiro, por isso o segundo recurso.

A imagem do front (nginx sem root) é construída com `VITE_API_URL=/api`, um caminho relativo. Front e API ficam na
mesma origem, o navegador não faz CORS, e a mesma imagem serve em qualquer host. O log de acesso do Ingress grava o
caminho sem a query string, por causa do token do SSE (ver [ADR-006](./ADR-006-autenticacao-e-acesso.md)).

### 2.5. Migrations num Job, com imagem própria

O Job `migrate` roda `prisma migrate deploy` e o seed com a imagem `4frames-migrate` (`packages/shared/Dockerfile`).

- É uma imagem à parte porque o CLI do Prisma, o `tsx` e o `bcrypt` do seed são devDependencies do `@4frames/shared` e
  não entram nas imagens dos apps.
- O `spec.template` de um Job é imutável, então o Job é recriado a cada deploy. Rodar de novo é seguro: o
  `migrate deploy` só aplica o que falta, e o seed usa `upsert`.
- O Job vai no mesmo `apply` dos Deployments, e o script espera ele terminar antes de reiniciar os apps e conferir os
  rollouts. O cluster ganha schema sem depender do serviço `migrate` do Compose, que continua para o desenvolvimento.

### 2.6. Rotina de expiração num CronJob

O CronJob `expire-uploads` roda a cada minuto, com a imagem da API e `node dist/cron/main.js --once`,
`concurrencyPolicy: Forbid`, `activeDeadlineSeconds: 50` e `backoffLimit: 0`.

- O Kubernetes garante uma execução por vez, sem eleição de líder e fora das réplicas da API.
- Nada fica ocioso entre as passadas. Uma passada presa não segura as seguintes, e uma falha espera o minuto seguinte.
- O modo laço do mesmo entrypoint fica para o desenvolvimento.

### 2.7. Um comando para subir e derrubar

`./scripts/k8s-local.sh up` leva do clone ao front funcionando:

1. confere ferramentas, Docker e o clone do `4frames-web-app` ao lado (ou em `WEB_APP_DIR`), e cria o `.env` se faltar;
2. sobe a infra no Compose e cria ou reusa o cluster;
3. constrói e carrega as imagens `api`, `worker`, `notifier`, `migrate` e `web`;
4. instala metrics-server (0.9.0, com `--kubelet-insecure-tls`), ingress-nginx (1.15.1) e KEDA (2.16.1);
5. gera o Secret, aplica `overlays/local`, com o Job de migrations, e espera o Job terminar;
6. confere `/` e `/api/ready` pelo Ingress.

Num cluster reusado, ele reinicia só os Deployments cuja imagem mudou e, quando o ConfigMap ou o Secret mudam, também
API, worker e notificador. `down` apaga o cluster, e `down --all` também para a infra do Compose, sem apagar o volume do
Postgres.

## 3. Consequências

### 3.1. Positivas

- Um comando leva do clone à solução no navegador, sem conta de nuvem e sem registry.
- O CD usa os mesmos manifestos, com um overlay, na mesma ferramenta de cluster.
- A infra é a mesma no desenvolvimento com Compose e no cluster. Um bug de integração aparece nos dois.
- O schema do banco não depende do Compose, e a rotina de expiração não depende das réplicas da API.
- Front e API na mesma origem dispensam CORS e fazem a imagem do front independente do endereço.

### 3.2. Negativas e trade-offs

- O cluster depende da infra do Compose no mesmo host. Um cluster remoto exigiria outros endereços, ou a infra dentro
  dele.
- Depois de reiniciar a máquina ou o Docker Desktop, o nó do Kind volta sem as portas publicadas. É preciso recriar o
  cluster (`down` e `up`), e o script avisa.
- Num cluster recém-criado, os pods da API sobem junto com o Job de migrations e só atendem direito depois dele. A
  conferência final pelo Ingress espera isso.
- O ingress-nginx foi arquivado, e a 1.15.1 é a última versão. Serve ao cluster local, mas não recebe correções de
  segurança. Na AWS, o Ingress volta a ser o AWS Load Balancer Controller do ADR-001.
- A imagem `4frames-migrate` tem cerca de 860 MB, porque leva o CLI e o motor de migrations do Prisma.
- O `up` precisa do clone do `4frames-web-app` para construir o front.
- O cluster do CD não tem Postgres nem LocalStack. O smoke prova que as imagens sobem, não o fluxo de vídeo (ver
  [ADR-007](./ADR-007-qualidade-testes-e-entrega.md)).

## 4. Relação com outros ADRs

- Completa a seção 2.2 do ADR-002, que deixava estas escolhas em aberto.
- Réplicas, escala e encerramento dos pods estão no [ADR-004](./ADR-004-escala-e-encerramento-sem-perda.md).
- Detalhes de operação: [`infra/k8s/README.md`](../../infra/k8s/README.md).
