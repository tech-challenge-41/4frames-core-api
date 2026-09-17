# ADR-002: Execução local com Docker Compose e LocalStack, monorepo do backend e job com UUID

## Status

Aceito. Substitui partes do [ADR-001](./ADR-001-arquitetura.pdf) (ver seção 4).

## Data

2026-09-17

## 1. Contexto

O ADR-001 definiu uma arquitetura orientada a eventos na AWS: upload direto ao S3, evento S3 → SQS com DLQ, workers
no EKS escalados pelo KEDA, API atrás de ALB, Redis no ElastiCache, RDS, SES, CloudFront, Terraform e Datadog, com um
repositório por serviço.

Três pontos pesaram na revisão:

- O enunciado do Hackathon exige Docker, mensageria, persistência, escalabilidade, testes e CI/CD, mas não exige nuvem.
  A stack recomendada inclui "Docker + Kubernetes ou Docker Compose".
- Faltam cerca de duas semanas para a entrega (28/09), e a conta AWS Academy tem limites já apontados no ADR-001 (LabRole
  sem roles próprias para IRSA e KEDA, SES em sandbox).
- Worker e notifier precisam do mesmo schema de banco e dos mesmos contratos da API: chaves do S3, canais do Redis,
  formato dos eventos e estados do job.

## 2. Decisão

### 2.1. Toda a solução roda localmente com Docker Compose

Nada é provisionado na AWS. O desenho do ADR-001 continua o mesmo, com substitutos locais:

| ADR-001                              | Substituto local                                                     | Situação em 17/09                           |
| ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| S3 com Event Notifications           | LocalStack S3: bucket, CORS e notificação `videos/` → SQS            | Implementado                                |
| SQS + DLQ                            | LocalStack SQS, redrive para a DLQ após 3 recebimentos               | Implementado                                |
| RDS PostgreSQL 16                    | Container `postgres:16`                                              | Implementado                                |
| ElastiCache Redis                    | Container `redis:7`                                                  | Container no ar; uso pelos apps previsto    |
| SES                                  | Mailpit (SMTP local com caixa web)                                   | Container no ar; uso pelo notifier previsto |
| Terraform                            | Scripts de init do LocalStack e migrations do Prisma                 | Implementado                                |
| CloudFront no download               | URL pré-assinada de GET do S3                                        | Previsto                                    |
| ALB + HPA                            | nginx na frente de réplicas da API (`--scale api=N`)                 | Previsto                                    |
| EKS + KEDA                           | Réplicas do worker com `--scale worker=N`                            | Previsto                                    |
| OpenTelemetry + Datadog + CloudWatch | Prometheus + Grafana                                                 | Previsto                                    |
| ECR + deploy no EKS                  | Imagens no GitHub Container Registry, publicadas por tag `release-*` | Previsto                                    |

Consequências diretas no código:

- Um único `.env` usa endereços do host. O Compose sobrescreve só os hosts internos, e o mesmo arquivo serve para os apps
  rodando no host ou em container.
- O S3 tem dois endereços. A API acessa o S3 por `AWS_ENDPOINT_URL` (interno ao Compose) e assina as URLs com
  `S3_PUBLIC_ENDPOINT_URL`, o endereço que o navegador alcança.
- O código usa o AWS SDK padrão, com endpoints vindos de variáveis de ambiente. Rodar na AWS real é questão de
  configuração e infraestrutura, sem mudança de código.

### 2.2. Monorepo pnpm para o backend

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
- Cada serviço continua com sua própria imagem Docker. As imagens são construídas a partir da raiz do repositório.

### 2.3. Identificador do job em UUID

`video_jobs.id` é um UUID gerado pelo PostgreSQL. O id aparece na URL compartilhável do job e na chave do objeto
(`videos/{userId}/{jobId}/source.{ext}`), e um inteiro sequencial seria enumerável.

A mesma migration adiciona as colunas que o processamento precisa (`file_size`, `failure_reason`, `zip_key`,
`frame_count`, `duration_seconds`, `notified_at`, `correlation_id`), a chave estrangeira para `users` e o índice
`(user_id, created_at desc)` da listagem.

### 2.4. Regra de extração de frames

O worker segue o projeto base apresentado aos investidores: `ffmpeg -vf fps=1`, um frame por segundo, em PNG, com nomes
`frame_0001.png`, `frame_0002.png`… na raiz do zip. O ADR-001 falava em "1 frame a cada N segundos"; o valor fica em
`FRAME_FPS=1` e `FRAME_FORMAT=png`. Situação: previsto, com o worker.

### 2.5. Qualidade e entrega

- Fluxo de branches `feature → develop → main`, com tag `release-*` em `main` a cada entrega.
- Os repositórios são privados no plano GitHub Free, que não oferece branch protection. A revisão obrigatória vale por
  regra do grupo (`CONTRIBUTING.md`), não por bloqueio do GitHub.
- Sem SonarQube: o gate de qualidade é o limite de cobertura do Jest e do Vitest no CI (previsto).
- Hook de pre-commit com lint-staged (ESLint e Prettier nos arquivos staged). Situação: implementado.

## 3. Consequências

### 3.1. Positivas

- A solução inteira sobe com `docker compose up -d --build`, sem conta nem custo de nuvem, em qualquer máquina com Docker.
  O avaliador consegue rodar a demonstração.
- O fluxo e as garantias do ADR-001 continuam: bytes fora da API, evento só com o objeto gravado, DLQ, workers autônomos
  pela chave do objeto e ordem de gravação S3 → banco → Redis.
- Uma mudança de contrato entre serviços entra num único PR, com um lockfile, uma configuração de lint e um Compose.

### 3.2. Negativas e trade-offs

- Não há auto-scaling pela profundidade da fila nem scale-to-zero. A escala é manual (`--scale`).
- Não há CDN no download do zip.
- O LocalStack não reproduz tudo da AWS. Ele não valida assinaturas de URLs pré-assinadas, não persiste objetos e
  mensagens entre reinícios e publica um `s3:TestEvent` na fila a cada start. O ambiente local não prova as garantias
  de segurança das URLs, e o worker precisa ignorar o `s3:TestEvent`.
- No monorepo, uma mudança no `shared` exige recompilar o pacote antes de rodar os apps, e o CI precisa filtrar os
  pacotes afetados para não rodar tudo sempre.
- Deploy em nuvem fica fora da entrega. Voltar para a AWS exige recriar a infraestrutura como código.

## 4. Relação com o ADR-001

**Continua valendo:** os três planos (controle, dados e processamento), o fluxo ponta a ponta da seção 2.2, as garantias
da seção 2.3 (idempotência, ordem de gravação, filtro por prefixo contra laço de eventos, expiração de uploads
abandonados) e as decisões da seção 3 sobre upload direto, evento S3 → SQS, SQS com DLQ, chave do objeto com dono e job,
Redis para progresso, PostgreSQL para status e notificador desacoplado.

**Substituído por este ADR:**

- As tecnologias AWS da tabela de componentes (seção 2.1 do ADR-001), conforme a seção 2.1 acima.
- O download pela CloudFront no passo 8 do fluxo, que passa a ser URL pré-assinada do S3.
- Auto-scaling com KEDA e HPA, IRSA, OAC e segredos no Kubernetes (seção 2.3 do ADR-001).
- Observabilidade com OpenTelemetry, Datadog e CloudWatch (seção 2.3 do ADR-001).
- "Um repositório por serviço", Terraform, SonarQube, push no ECR e deploy no EKS (seção 2.4 do ADR-001).
- A regra "1 frame a cada N segundos", que passa a ser a da seção 2.4 acima.
