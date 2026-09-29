# ADR-004: Escala automática e encerramento sem perda de requisição nem de vídeo

## Status

Aceito.

## Data

2026-09-23, quando entraram o KEDA no worker e o HPA na API. O encerramento gracioso do worker é de 2026-09-17, um
vídeo por réplica no cluster e as `startupProbe` são de 2026-09-24 e 2026-09-25, e a prontidão e o encerramento
gracioso da API, de 2026-09-27. Registrado em 2026-09-28, com as medições do mesmo dia.

## 1. Contexto

O enunciado pede que o sistema processe mais de um vídeo ao mesmo tempo e não perca requisição em pico. O ADR-001
decidiu como: HPA na API, KEDA nos workers pela profundidade da fila e `terminationGracePeriodSeconds` que cobre um
job. Faltava definir os números e o comportamento dos processos quando o Kubernetes os tira do ar, que acontece a cada
scale-down, rolling update ou reinício.

Dois problemas apareceram na implementação:

- **A API ignorava o SIGTERM.** Como PID 1 do container e sem handler, o kernel descarta o sinal. O pod seguia
  atendendo já fora do Ingress, ficava 30 s em `Terminating`, saía no SIGKILL e cortava os streams SSE no meio.
- **Paralelismo dentro do processo e escala por réplica se somam.** O worker processa até `WORKER_MAX_PARALLEL_JOBS`
  vídeos por processo. Se isso passar de 1, o número de réplicas do KEDA deixa de ser o número de vídeos em paralelo.

## 2. Decisão

### 2.1. Worker: um vídeo por réplica, escalado pelo KEDA

- No cluster, `WORKER_MAX_PARALLEL_JOBS=1`: cada réplica processa um vídeo, e o máximo de réplicas é o máximo de vídeos
  em paralelo. No Compose de desenvolvimento, o padrão é 2, sem KEDA.
- `ScaledObject` com o scaler `aws-sqs-queue`, apontado para o LocalStack: `queueLength: 1` (uma réplica por
  mensagem), de 1 a 5 réplicas, consulta à fila a cada 5 s.
- Na redução, uma janela de estabilização de 30 s evita que a fila oscilando derrube e recrie pods.
- O mínimo é 1, não 0. O primeiro vídeo depois de um período ocioso não espera um pod subir. O custo é um pod parado.
- Requests de 100m de CPU e limite de 2 CPUs por réplica, porque o ffmpeg usa o que houver.

### 2.2. Worker: sair só depois de terminar o vídeo

- No SIGTERM, o worker para de receber mensagens, termina o vídeo em andamento e sai, dentro de
  `WORKER_SHUTDOWN_TIMEOUT_SECONDS` (570 s). O `terminationGracePeriodSeconds` é 600 s, acima desse prazo. Um
  processamento mais longo que isso é interrompido sem apagar a mensagem, que volta à fila quando a visibilidade vence.
- Enquanto termina, o `/healthz` continua respondendo 200, para a liveness não matar o pod no meio do encerramento.
- Durante o processamento, o worker renova a visibilidade da mensagem a cada metade do `VISIBILITY_TIMEOUT_SECONDS`
  (600 s). Se o pod morrer mesmo assim, a mensagem reaparece na fila e outro worker retoma o job: a transição para
  `PROCESSING` aceita um job que já estava em `PROCESSING`.

### 2.3. API: réplicas pelo HPA, prontidão real e encerramento gracioso

- HPA por CPU: de 2 a 4 réplicas, com alvo de 70 % do `requests.cpu`. O metrics-server fornece a métrica.
- **Liveness e readiness separadas.** `GET /health-check` só diz que o processo está de pé. `GET /ready` confere
  Postgres (`SELECT 1`) e Redis (`PING`), com 2 s para cada um, e responde 200 ou 503. Com o banco fora, a réplica sai
  do balanceamento, mas não é reiniciada.
- **Encerramento gracioso**, com o prazo `API_SHUTDOWN_TIMEOUT_SECONDS` (20 s):
  1. o `preStop` segura o SIGTERM por 5 s, o tempo de o Ingress tirar o pod do balanceamento;
  2. no SIGTERM, a API para de aceitar conexões e responde o que já chegou com `Connection: close`;
  3. os streams SSE abertos terminam com `retry: 1000`, e o `EventSource` reconecta em outra réplica;
  4. a API espera as requisições em curso, fecha Prisma e Redis e sai.
- O `terminationGracePeriodSeconds` da API é 35 s, acima do `preStop` mais o prazo de encerramento.

### 2.4. Todos: tempo para subir

API, worker e notificador têm `startupProbe` de até 150 s. Liveness e readiness só começam depois da primeira resposta,
então uma réplica nova que demora a subir num host carregado não é reiniciada antes de ficar pronta.

## 3. Consequências

### 3.1. Positivas

A escala e o encerramento do worker foram medidos contra o cluster, com os resultados em
[`docs/evidence`](../evidence/README.md):

- Em três picos de 10 vídeos, com 10 usuários consultando a listagem, 2.489 requisições responderam sem erro e os 30
  vídeos chegaram a `DONE`.
- O KEDA pediu o 2º worker 18,5 s depois do início do pico, tinha 5 prontos aos 40 s e voltou a 1 sozinho com a fila
  vazia.
- Com 5 vídeos em processamento, o máximo do KEDA caiu para 1. Os 4 workers que saíram terminaram o vídeo, uns 27 s
  depois do SIGTERM, e só então encerraram. Nenhum vídeo voltou à fila nem se perdeu.

O encerramento da API foi medido num teste manual, que não está versionado: num `rollout restart` com leituras, escritas
não idempotentes e um stream SSE abertos, nenhuma requisição falhou. Cada pod antigo saiu em cerca de 5,5 s, e o SSE
reconectou em cerca de 1 s.

### 3.2. Negativas e trade-offs

- **Numa máquina só, mais workers não significam mais vazão.** Com 5 workers, o último vídeo terminou só cerca de 20 %
  antes que com 1 (102,7 s contra 128,7 s). Os workers dividem os mesmos 8 CPUs e o LocalStack, um processo só para
  todo o S3. Num cluster com mais nós, cada worker teria o próprio processador.
- Um worker escolhido para sair no meio de um vídeo longo segura o pod por até 10 min. É o preço de não interromper o
  processamento. Um processamento que passe disso é refeito do começo por outro worker.
- O HPA da API reage à CPU, que sobe tarde. Como a API não carrega os bytes do vídeo, ela não é o gargalo no pico. Os
  2 pods mínimos garantem que um rolling update nunca deixe a API sem réplica.
- Um pod de worker fica ligado mesmo sem vídeo, pelo mínimo de 1.

## 4. Relação com outros ADRs

- Implementa as garantias de auto-scaling e de `terminationGracePeriodSeconds` da seção 2.3 do ADR-001.
- O cluster e o comando que instala KEDA e metrics-server estão no
  [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md).
- O que acontece com o job em cada falha está no [ADR-005](./ADR-005-ciclo-de-vida-do-job.md).
