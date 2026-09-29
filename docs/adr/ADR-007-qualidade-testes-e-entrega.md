# ADR-007: Qualidade, testes e entrega contínua

## Status

Aceito. Detalha e atualiza a seção 2.6 do [ADR-002](./ADR-002-execucao-local-e-monorepo.md).

## Data

2026-09-22, quando entraram o CI com gate de cobertura e o CD por tag. O CI em toda PR, os testes HTTP com a paridade
do OpenAPI, o CI do web-app, o ponta a ponta e os cenários de carga entraram em 2026-09-28. Registrado em 2026-09-28.

## 1. Contexto

O enunciado pede testes que garantam a qualidade e CI/CD. O ADR-001 previa Jest, supertest, integração com LocalStack e
Postgres, vídeos de amostra no worker, k6, SonarQube e deploy no EKS. O ADR-002 tirou o SonarQube e o EKS e deixou o
limite de cobertura como gate.

Faltava decidir:

- o que cada camada de teste prova e onde ela roda;
- como provar "processa vários vídeos ao mesmo tempo" e "não perde requisição", que teste unitário não prova;
- o que o CD consegue provar num cluster efêmero sem Postgres nem LocalStack;
- como o grupo trabalha sem branch protection, que o plano GitHub Free não oferece em repositório privado.

## 2. Decisão

### 2.1. Camadas de teste

| Camada               | Onde                                                             | O que prova                                                                                                                              | Onde roda                |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Unitário             | Ao lado do código, nos quatro pacotes (Jest) e no front (Vitest) | Use cases, adaptadores e telas, com as dependências simuladas pelas interfaces                                                           | CI, em toda PR           |
| HTTP                 | `apps/api/src/infra/http/**/__tests__`                           | As rotas pelo app Express real (`createHttpApp`), com os middlewares reais: 401, 400, UUID, paginação, download e o SSE lido como stream | CI                       |
| Paridade OpenAPI     | `openapi-parity.spec.ts`                                         | Toda rota registrada no Express tem operação no OpenAPI, e o contrário                                                                   | CI                       |
| Integração do worker | `apps/worker/test/integration`                                   | ffmpeg de verdade sobre vídeos de amostra: número de frames, nomes e ordem dentro do zip                                                 | CI, com ffmpeg instalado |
| Ponta a ponta        | `tests/e2e` (`pnpm test:e2e`)                                    | Login, upload, SSE até o `job.done`, zip, e-mail, falha com e-mail, listagem e 404 para outro usuário, pelo Ingress                      | Local, contra o cluster  |
| Carga e escala       | `tests/load` (k6)                                                | Pico de uploads com listagem em paralelo: nenhum erro, nenhum vídeo perdido, o KEDA subindo e descendo workers                           | Local, contra o cluster  |

- Os testes de caso de uso nunca tocam Prisma nem o SDK da AWS: simulam a interface da porta.
- Os testes ponta a ponta e de carga não sobem nada. Eles assumem a stack no cluster (`./scripts/k8s-local.sh up`) e
  usam o `user@user.com`, para não mexer na listagem do `admin@admin.com`.
- O k6 roda no container `grafana/k6`, sem instalação. O `run-scenario.sh` grava workers, fila e jobs ao longo do
  cenário e sai com erro se alguma requisição falhar ou algum vídeo não chegar a `DONE`.

### 2.2. Evidência versionada

Os resultados de carga e escala ficam em [`docs/evidence`](../evidence/README.md), um diretório por cenário: resumo,
gráfico dos workers e dos vídeos, `kubectl get pods -w` com horário, dados brutos e a saída do k6. A contagem de
vídeos concluídos vem do banco, não do k6. Um requisito que depende do cluster fica provado por arquivo no repositório,
não só por um teste que roda na máquina de alguém.

### 2.3. Gate de cobertura

O gate de qualidade é o limite mínimo de cobertura, conferido no CI (sem SonarQube, ADR-002):

| Pacote            | Statements / branches / functions / lines |
| ----------------- | ----------------------------------------- |
| `apps/api`        | 91 / 79 / 88 / 91                         |
| `apps/notifier`   | 98 / 79 / 98 / 98                         |
| `apps/worker`     | 90 / 80 / 90 / 90                         |
| `packages/shared` | 90 / 80 / 90 / 90                         |
| `4frames-web-app` | 76 / 74 / 70 / 77                         |

Cada limite fica pouco abaixo do medido. Ele sobe quando a cobertura sobe e nunca desce para uma PR passar.

### 2.4. CI em toda PR

- **core-api:** `test` (com o gate e com ffmpeg, para a integração do worker) → `lint` (ESLint e Prettier) →
  `type-check` → `validate-k8s` (os dois overlays renderizados e validados com `kubeconform -strict`) → `build-images`
  (`api`, `worker`, `notifier` e `migrate`).
- **web-app:** `test` (com o gate) → `lint` (ESLint e Prettier) → `type-check` → `build` (Vite e a imagem Docker, com
  smoke: `/healthz`, rotas da SPA, 404 de asset e processo sem root).
- O CI roda em toda PR, inclusive as empilhadas sobre outra branch, e em push para `develop` e `main`. Com um filtro
  pela base, uma PR empilhada não passava por CI, e a troca da base depois do merge da PR de baixo também não o
  disparava.

### 2.5. CD por tag, com deploy num Kind efêmero

A cada tag `release-*`:

- **core-api:** constrói as quatro imagens e as publica no GHCR com a tag, sobe um Kind efêmero no GitHub Actions,
  carrega as imagens de API, worker e notificador, instala o KEDA e aplica `overlays/ci`. O smoke confere o `/health-check` da API, o `/healthz` do
  worker e o rollout do notificador.
- **web-app:** constrói a imagem do front, roda o mesmo smoke do CI e só então publica `4frames-web` no GHCR.

### 2.6. Fluxo de trabalho sem branch protection

- `feature → develop → main`, com tag `release-*` em `main` a cada entrega.
- Toda mudança entra por PR, com CI verde e aprovação de outra pessoa, e quem mescla não é o autor. O GitHub Free não
  impõe isso em repositório privado; vale por regra do grupo, no `CONTRIBUTING.md`.
- PRs empilhadas são permitidas: a branch nova sai da PR aberta mais alta, e a PR usa essa branch como base. O merge vai
  de baixo para cima, apagando a branch, para o GitHub mudar a base da PR seguinte sozinho.
- Commits em Conventional Commits, feitos sempre por uma pessoa. O pre-commit roda ESLint e Prettier nos arquivos
  staged (Husky e lint-staged).

## 3. Consequências

### 3.1. Positivas

- Cada requisito do enunciado tem uma prova: testes no CI para o comportamento, e o ponta a ponta e a carga com
  evidência versionada para o que só existe no cluster.
- Uma rota nova sem documentação no OpenAPI quebra o CI. Uma rota existente que perca a autenticação também.
- O CD prova que as imagens publicadas sobem e respondem saúde no Kubernetes, com os mesmos manifestos do cluster local.

### 3.2. Negativas e trade-offs

- **O ponta a ponta e a carga não rodam no CI.** Eles precisam da stack inteira: cluster, Postgres, Redis, LocalStack e
  Mailpit. No GitHub Actions, isso pesaria em toda PR. Ficam como execução local, com o resultado guardado em
  `docs/evidence`, e uma regressão só aparece quando alguém os roda de novo.
- **O smoke do CD não testa o fluxo de vídeo.** O Kind efêmero não tem Postgres nem LocalStack: sem eles, o overlay
  `ci` tira as migrations, a expiração e o front, e a readiness da API volta a `/health-check`.
- As evidências de carga são de uma máquina só, com as limitações do [ADR-004](./ADR-004-escala-e-encerramento-sem-perda.md).
- Sem branch protection, as regras dependem de disciplina. Um push direto em `develop` não é bloqueado.
- O gate por cobertura mede linhas executadas, não a qualidade das asserções. A paridade OpenAPI e os testes HTTP
  compensam em parte, nas rotas.

## 4. Relação com outros ADRs

- Substitui, na seção 2.4 do ADR-001, o SonarQube, o push no ECR e o deploy no EKS, como o ADR-002 já registrava, e
  detalha a seção 2.6 do ADR-002.
- O overlay `ci` e o Kind efêmero estão no [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md).
