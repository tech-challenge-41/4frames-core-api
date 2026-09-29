# ADR-002: Execução local com Kubernetes e LocalStack, monorepo do backend e job com UUID

## Status

Aceito. Substitui partes do [ADR-001](./ADR-001-arquitetura.pdf) (ver seção 4). As decisões tomadas depois, na
implementação, estão nos ADR-003 a ADR-007 (ver o [índice](./README.md)).

## Data

2026-09-17

## 1. Contexto

O ADR-001 definiu uma arquitetura orientada a eventos na AWS: upload direto ao S3, evento S3 → SQS com DLQ, workers
no EKS escalados pelo KEDA, API atrás de ALB com HPA, Redis no ElastiCache, RDS, SES, CloudFront, Terraform e Datadog,
com um repositório por serviço.

Três pontos pesaram na revisão:

- O enunciado do Hackathon exige Docker, mensageria, persistência, escalabilidade, testes e CI/CD, mas não exige nuvem.
  A stack recomendada inclui "Docker + Kubernetes ou Docker Compose". O grupo mantém o Kubernetes: é ele que escala os
  workers pela profundidade da fila e a API pela carga.
- O tempo é curto e a conta AWS Academy tem limites já apontados no ADR-001 (LabRole
  sem roles próprias para IRSA e KEDA, SES em sandbox). O risco está em provisionar na nuvem, não no Kubernetes.
- Worker e notifier precisam do mesmo schema de banco e dos mesmos contratos da API: chaves do S3, canais do Redis,
  formato dos eventos e estados do job.

## 2. Decisão

### 2.1. Nada é provisionado na AWS; o Kubernetes roda num cluster local

Os serviços gerenciados da AWS dão lugar a equivalentes locais, e a orquestração do ADR-001 continua em Kubernetes:

| ADR-001                                 | Substituto local                                                                        | Situação                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| EKS                                     | Cluster Kubernetes local                                                                | Implementado: Kind ([ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md))                                 |
| ALB (AWS Load Balancer Controller)      | Ingress controller do cluster                                                           | Implementado: ingress-nginx ([ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md))                        |
| HPA na API                              | HPA na API, com metrics-server                                                          | Implementado ([ADR-004](./ADR-004-escala-e-encerramento-sem-perda.md))                                            |
| KEDA (scaler `aws-sqs-queue`) no worker | KEDA com o mesmo scaler, apontado para o LocalStack (`awsEndpoint`)                     | Implementado ([ADR-004](./ADR-004-escala-e-encerramento-sem-perda.md))                                            |
| Segredos no Kubernetes + IRSA           | Secrets e ConfigMaps; credenciais fixas do LocalStack no lugar do IRSA                  | Implementado ([ADR-006](./ADR-006-autenticacao-e-acesso.md))                                                      |
| ECR + deploy no EKS                     | Imagens no GitHub Container Registry por tag `release-*`; deploy no cluster local       | Implementado: CD com deploy num Kind efêmero ([ADR-007](./ADR-007-qualidade-testes-e-entrega.md))                 |
| S3 com Event Notifications              | LocalStack S3: bucket, CORS e notificação `videos/` → SQS                               | Implementado                                                                                                      |
| SQS + DLQ                               | LocalStack SQS, redrive para a DLQ após 3 recebimentos                                  | Implementado                                                                                                      |
| RDS PostgreSQL 16                       | Container `postgres:16`                                                                 | Implementado                                                                                                      |
| ElastiCache Redis                       | Container `redis:7`                                                                     | Implementado: progresso, eventos do job e SSE                                                                     |
| SES                                     | Mailpit (SMTP local com caixa web)                                                      | Implementado: e-mail do notificador na conclusão e na falha                                                       |
| Terraform                               | Scripts de init do LocalStack, migrations do Prisma e manifestos Kubernetes versionados | Implementado: migrations e seed num Job do cluster ([ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md)) |
| CloudFront no download                  | URL pré-assinada de GET do S3                                                           | Implementado                                                                                                      |
| OpenTelemetry + Datadog + CloudWatch    | Prometheus + Grafana                                                                    | Previsto                                                                                                          |

Consequências diretas no código:

- O código usa o AWS SDK padrão, com endpoints vindos de variáveis de ambiente. Rodar na AWS real é questão de
  configuração e infraestrutura, sem mudança de código.
- O S3 tem dois endereços. A API acessa o S3 por `AWS_ENDPOINT_URL` (interno) e assina as URLs com
  `S3_PUBLIC_ENDPOINT_URL`, o endereço que o navegador alcança.
- Um único `.env` usa endereços do host. No Compose, os serviços sobrescrevem só os hosts internos. No cluster, as mesmas
  variáveis chegam por ConfigMap e Secret.

### 2.2. Papéis do Kubernetes e do Docker Compose

**Kubernetes** é onde a stack completa roda, escala e é demonstrada:

- `api`: Deployment com várias réplicas atrás do Ingress, HPA por CPU, probes de liveness e readiness e encerramento
  gracioso. SSE funciona em qualquer réplica porque o progresso chega pelo Redis Pub/Sub.
- `worker`: Deployment escalado pelo KEDA pela profundidade da fila SQS, um vídeo por réplica.
  `terminationGracePeriodSeconds` cobre a duração de um job, e o scale-down não interrompe um processamento.
- `notifier`, rotina de expiração de uploads (uma execução por vez) e front, com o Ingress roteando `/` para o front e
  `/api` para a API.

**Docker Compose** é o ambiente de desenvolvimento: Postgres, Redis, Mailpit, LocalStack, migrations e os apps (API e
notificador em modo dev, worker compilado). Não é o mecanismo de escala da solução.

Este ADR deixava em aberto a distribuição do cluster, onde rodam Postgres, Redis, LocalStack e Mailpit e o formato dos
manifestos. As escolhas estão no [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md): Kind, infraestrutura no
Compose, fora do cluster, e Kustomize em `infra/k8s/`.

Valem para qualquer escolha: o navegador precisa alcançar o LocalStack pelo endereço de `S3_PUBLIC_ENDPOINT_URL`, e as
imagens privadas do GHCR exigem `imagePullSecret` ou importação local no cluster.

### 2.3. Monorepo pnpm para o backend

O repositório `4frames-core-api` concentra os serviços de backend. O front continua em `4frames-web-app`.

| Pacote            | Responsabilidade                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api`        | API REST (hexagonal): autenticação, jobs e URLs pré-assinadas                                                |
| `apps/worker`     | Consumo da fila, extração de frames e zip                                                                    |
| `apps/notifier`   | Assinatura de eventos terminais e envio de e-mail                                                            |
| `packages/shared` | Prisma (schema, migrations, client), carga do `.env`, logger, contratos entre serviços, clientes AWS e Redis |

- Os contratos entre serviços têm uma única fonte em `packages/shared`: chaves do S3, canais do Redis, eventos de job
  validados com zod e estados do job.
- Os apps consomem o `shared` compilado, por subcaminhos (`@4frames/shared/prisma`, `/jobs`, `/aws`…). Importar um
  contrato não abre conexão com o banco nem carrega SDKs.
- Cada serviço continua com sua própria imagem Docker e seu próprio Deployment no cluster. As imagens são construídas a
  partir da raiz do repositório.

### 2.4. Identificador do job em UUID

`video_jobs.id` é um UUID gerado pelo PostgreSQL. O id aparece na URL compartilhável do job e na chave do objeto
(`videos/{userId}/{jobId}/source.{ext}`), e um inteiro sequencial seria enumerável.

A mesma migration adiciona as colunas que o processamento precisa (`file_size`, `failure_reason`, `zip_key`,
`frame_count`, `duration_seconds`, `notified_at`, `correlation_id`), a chave estrangeira para `users` e o índice
`(user_id, created_at desc)` da listagem.

### 2.5. Regra de extração de frames

O worker segue o projeto base apresentado aos investidores: `ffmpeg -vf fps=1`, um frame por segundo, em PNG, com nomes
`frame_0001.png`, `frame_0002.png`… na raiz do zip. O ADR-001 falava em "1 frame a cada N segundos"; o valor fica em
`FRAME_FPS=1` e `FRAME_FORMAT=png`. Situação: implementado no `apps/worker`.

### 2.6. Qualidade e entrega

- Fluxo de branches `feature → develop → main`, com tag `release-*` em `main` a cada entrega.
- Os repositórios são privados no plano GitHub Free, que não oferece branch protection. A revisão obrigatória vale por
  regra do grupo (`CONTRIBUTING.md`), não por bloqueio do GitHub.
- Sem SonarQube/SonarCloud: o gate de qualidade é o limite mínimo de cobertura do Jest e do Vitest no CI.
- O CI (`.github/workflows/ci.yml`) roda test → lint → type-check → validação dos manifestos Kubernetes → build das
  imagens `api`, `worker`, `notifier` e `migrate`. A cada tag `release-*`, o CD (`.github/workflows/cd.yml`) publica as
  imagens no GHCR, sobe um Kind efêmero no GitHub Actions, carrega as imagens dos apps, aplica o overlay `ci` de
  `infra/k8s` e faz smoke test.
  Situação: implementado. Camadas de teste, gates e fluxo de trabalho: [ADR-007](./ADR-007-qualidade-testes-e-entrega.md).
- Hook de pre-commit com lint-staged (ESLint e Prettier nos arquivos staged). Situação: implementado.

## 3. Consequências

### 3.1. Positivas

- A solução roda sem conta nem custo de nuvem, em qualquer máquina com Docker. O avaliador consegue rodar a demonstração.
- A escala do ADR-001 continua: workers pela profundidade da fila (KEDA, com scale-to-zero possível), API pela carga
  (HPA) e scale-down sem interromper um job em andamento.
- O fluxo e as garantias do ADR-001 continuam: bytes fora da API, evento só com o objeto gravado, DLQ, workers autônomos
  pela chave do objeto e ordem de gravação S3 → banco → Redis.
- Voltar para a AWS reaproveita as imagens e a maior parte dos manifestos. Muda a infraestrutura em volta: EKS, serviços
  gerenciados, IRSA e o Ingress do ALB.
- Uma mudança de contrato entre serviços entra num único PR, com um lockfile e uma configuração de lint.

### 3.2. Negativas e trade-offs

- O cluster roda numa máquina só. A escala automática é real, mas limitada aos núcleos e à memória dessa máquina: mais
  réplicas de worker do que núcleos não aceleram o processamento.
- Mais peças para operar localmente: cluster, Ingress controller, metrics-server e KEDA, além de LocalStack, Postgres,
  Redis e Mailpit, todos disputando a memória do Docker Desktop.
- Dois ambientes para manter: Compose no desenvolvimento e manifestos no cluster, com as mesmas variáveis em dois
  formatos.
- Não há CDN no download do zip.
- O LocalStack não reproduz tudo da AWS. Ele não valida assinaturas de URLs pré-assinadas, não persiste objetos e
  mensagens entre reinícios e publica um `s3:TestEvent` na fila a cada start. O ambiente local não prova as garantias
  de segurança das URLs, e o worker precisa ignorar o `s3:TestEvent`.
- No monorepo, uma mudança no `shared` exige recompilar o pacote antes de rodar os apps, e o CI precisa filtrar os
  pacotes afetados para não rodar tudo sempre.
- Deploy em nuvem fica fora da entrega. Voltar para a AWS exige recriar a infraestrutura como código.

## 4. Relação com o ADR-001

**Continua valendo:** os três planos (controle, dados e processamento), o fluxo ponta a ponta da seção 2.2, as garantias
da seção 2.3 (idempotência, ordem de gravação, filtro por prefixo contra laço de eventos, auto-scaling com KEDA e
`terminationGracePeriodSeconds`, expiração de uploads abandonados, segredos no Kubernetes) e as decisões da seção 3
sobre upload direto, evento S3 → SQS, SQS com DLQ, chave do objeto com dono e job, workers escalados pelo KEDA, API
stateless atrás de um balanceador, Redis para progresso, PostgreSQL para status e notificador desacoplado.

**Substituído por este ADR:**

- Os serviços gerenciados da AWS da tabela de componentes (seção 2.1 do ADR-001) e o EKS como serviço gerenciado,
  conforme a seção 2.1 acima.
- O ALB, que passa a ser o Ingress controller do cluster local.
- O download pela CloudFront no passo 8 do fluxo, que passa a ser URL pré-assinada do S3.
- IRSA e OAC (seção 2.3 do ADR-001): credenciais fixas do LocalStack e bucket privado acessado por URL pré-assinada.
- Observabilidade com OpenTelemetry, Datadog e CloudWatch (seção 2.3 do ADR-001).
- "Um repositório por serviço", Terraform, SonarQube, push no ECR e deploy no EKS (seção 2.4 do ADR-001), conforme as
  seções 2.3 e 2.6 acima.
- A regra "1 frame a cada N segundos", que passa a ser a da seção 2.5 acima.
