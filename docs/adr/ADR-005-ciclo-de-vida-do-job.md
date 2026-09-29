# ADR-005: Ciclo de vida do job: transições condicionais, cancelamento, expiração, falhas e notificação

## Status

Aceito.

## Data

2026-09-17, quando o worker entrou com os estados do job e as transições condicionais. O cancelamento entrou em
2026-09-18, o claim do notificador em 2026-09-24, e a rotina de expiração e o percentual no REST em 2026-09-27.
Registrado em 2026-09-28.

## 1. Contexto

O ADR-001 definiu os estados do job (`UPLOAD_PENDING`, `QUEUED`, `PROCESSING`, `DONE`, `FAILED` e `EXPIRED`) e as
garantias do fluxo: idempotência, ordem de gravação S3 → banco → Redis, DLQ e expiração de uploads abandonados. A
implementação encontrou situações que o ADR-001 não cobria:

- Quatro processos escrevem no mesmo job: a API (`complete` e cancelamento), o worker, a rotina de expiração e o
  notificador. Eles podem agir sobre o mesmo job no mesmo instante.
- O S3 publica o evento no fim do `PUT`, antes de o navegador chamar `complete`. O worker pode receber a mensagem de um
  job que ainda está em `UPLOAD_PENDING`.
- O usuário pode desistir de um envio, o que o ADR-001 não previa.
- O Redis Pub/Sub entrega cada evento no máximo uma vez. Um notificador fora do ar perde o evento de fim do job.

## 2. Decisão

### 2.1. Toda transição é uma escrita condicional

As mudanças de status do worker, do cancelamento e da expiração são `updateMany` com o status esperado no `WHERE`.
Quando dois processos disputam o mesmo job, um vence e o outro recebe `count = 0` e desiste, sem lock e sem
sobrescrever o vencedor. O `complete` ainda é a exceção (ver 3.2).

```text
POST /videos ──► UPLOAD_PENDING ──complete──► QUEUED ──worker──► PROCESSING ──► DONE
                     │                          │                    │
                     │ expiração ou             │ cancelamento       └─ vídeo inválido ou 3 falhas ──► FAILED
                     │ cancelamento             │
                     └──────────► EXPIRED ◄─────┘
```

- `complete` confere que o job está em `UPLOAD_PENDING` e que o objeto existe no S3 (`HEAD`), e então grava `QUEUED`.
- O worker só leva a `PROCESSING` um job em `QUEUED` ou já em `PROCESSING`. O segundo caso é uma mensagem que voltou à
  fila depois da queda de outro worker, e o job é retomado.
- O worker descarta a mensagem de um job já `DONE`, `FAILED` ou `EXPIRED`. Uma entrega duplicada do SQS não processa o
  vídeo duas vezes.

### 2.2. O worker espera o `complete`

Se a mensagem chega com o job em `UPLOAD_PENDING`, o worker consulta o job por até 30 s. Se o `complete` não vier, a
mensagem volta à fila 30 s depois e é tentada de novo, até os 3 recebimentos da DLQ. O job nunca é processado antes de
a API confirmar o upload. Na prática, o front chama o `complete` logo depois do `PUT`, e a primeira espera basta.

### 2.3. Cancelamento reaproveita `EXPIRED`

`POST /videos/:jobId/cancel` leva a `EXPIRED` um job em `UPLOAD_PENDING` ou `QUEUED`. Um job já em processamento não é
cancelado.

- Não existe um status `CANCELLED`. `EXPIRED` já significa "terminal, sem resultado e sem falha do sistema", que é o
  caso do cancelamento. Um status novo exigiria migration e tratamento em todos os consumidores.
- Um job cancelado em `QUEUED` ainda tem a mensagem na fila. O worker encontra `EXPIRED` e a descarta.

### 2.4. Uploads abandonados expiram

A rotina de expiração, um CronJob a cada minuto (ver [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md)),
marca `EXPIRED` os jobs em `UPLOAD_PENDING` criados antes de agora − (`UPLOAD_URL_TTL_SECONDS` + 60 s). Com a URL de
upload de 5 min, isso dá 6 min. Os 60 s de folga cobrem um `PUT` que terminou no último instante da validade.

A mesma passada conta, e registra no log, os jobs em `PROCESSING` sem escrita há mais de 15 min, sinal de worker parado.
Ela não os altera: o worker só escreve no banco nas transições, então um vídeo longo em andamento não atualiza o
`updated_at`.

### 2.5. Erro do vídeo vira `FAILED`; erro do sistema volta à fila

- **Vídeo inválido** (formato, trilha de vídeo ausente ou duração acima de `MAX_VIDEO_DURATION_SECONDS`): `FAILED` com
  um motivo legível em português, evento `job.failed` e a mensagem é apagada. Tentar de novo não mudaria o resultado.
- **Qualquer outro erro** (S3, banco, ffmpeg morto por sinal ou falta de memória): a mensagem volta a ficar visível em
  60 s. Depois de 3 recebimentos, o SQS a move para a DLQ, e o worker que consome a DLQ marca o job `FAILED` com
  "Falha após 3 tentativas".

### 2.6. Progresso: efêmero no Redis, status durável no Postgres

- O worker publica o percentual em `job:{jobId}` (Pub/Sub) e guarda o último em `progress:{jobId}`, com TTL de 1 hora.
  O percentual vem do `-progress` do próprio ffmpeg, no máximo uma publicação por ponto percentual e por segundo.
- A API repassa o canal por SSE (`GET /videos/:jobId/events`), com uma conexão Redis dedicada por stream, o valor atual
  lido antes de assinar e heartbeat a cada 15 s. O stream termina no evento terminal.
- `GET /videos` e `GET /videos/:jobId` trazem o último percentual em `progress`, só para jobs em `PROCESSING`, com um
  `MGET` por requisição. Com o Redis fora, a resposta sai sem o campo, em vez de falhar.
- O front consulta o status a cada 3 s enquanto houver job não terminal. O polling é a fonte da verdade do status, e o
  SSE só acrescenta o percentual ao vivo.

### 2.7. Notificação: claim antes do envio e varredura de recuperação

- O notificador assina `jobs.events`. Antes de enviar, ele faz o _claim_ do job: grava `notified_at` com a condição
  `notified_at IS NULL`. Só quem vence o claim envia, então mais de uma réplica não duplica o e-mail.
- Se o envio falha, o claim é liberado.
- A cada 120 s (`NOTIFIER_RECOVERY_INTERVAL_SECONDS`), uma varredura procura jobs em `DONE` ou `FAILED` sem
  `notified_at`, de usuários ativos. Job expirado ou cancelado não gera e-mail. Um evento
  perdido pelo Pub/Sub vira um e-mail atrasado, não um e-mail que nunca chega.

## 3. Consequências

### 3.1. Positivas

- Disputas entre worker, cancelamento, rotina de expiração e notificador se resolvem no banco, sem lock distribuído.
- Entrega duplicada, queda de worker, upload confirmado com atraso e evento perdido têm um caminho definido. O teste
  ponta a ponta e os cenários de carga não perderam nenhum vídeo (ver [`docs/evidence`](../evidence/README.md)).
- A queda do Redis custa só o percentual: status, listagem e download continuam, porque vêm do Postgres e do S3.

### 3.2. Negativas e trade-offs

- **Cancelado e expirado se confundem.** A tela do job mostra "Cancelado" logo depois do clique, mas depois de
  recarregar, e na listagem, o job aparece como "Expirado". Se isso confundir o suporte ou as métricas, um status
  `CANCELLED` dedicado resolve.
- **Um job em `QUEUED` sem mensagem na fila fica em `QUEUED` para sempre.** A expiração só cobre `UPLOAD_PENDING`. Há
  duas causas:
  - o LocalStack reinicia com a mensagem na fila, porque não persiste mensagens. Na AWS a fila persiste;
  - o `complete` chega depois de uns 2,5 min do fim do `PUT`. Nesse ponto a mensagem já passou pelos 3 recebimentos e
    foi para a DLQ, e o worker da DLQ a descarta porque o job ainda estava em `UPLOAD_PENDING`.
- **O `complete` grava `QUEUED` sem condição.** Ele confere o status antes, mas grava com um `update` pelo id. Um
  cancelamento ou uma expiração no intervalo entre a leitura e a escrita é sobrescrito. A correção é levar
  `UPLOAD_PENDING` ao `WHERE`, como nas outras transições.
- Um job em `PROCESSING` parado é só contado no log, não corrigido. A mensagem dele volta à fila quando a visibilidade
  vence, e outro worker o retoma.
- Se o envio do e-mail falhar e a liberação do claim também falhar, o job fica marcado como notificado sem e-mail. O
  caso é registrado no log como erro.
- O vídeo inválido só é detectado no worker, depois do upload inteiro. A API valida tipo e tamanho, mas não o conteúdo.

## 4. Relação com outros ADRs

- Detalha as garantias da seção 2.3 do ADR-001: idempotência, ordem de gravação, DLQ e uploads abandonados.
- O encerramento do worker no meio de um vídeo está no [ADR-004](./ADR-004-escala-e-encerramento-sem-perda.md).
- Quem pode ver e alterar cada job está no [ADR-006](./ADR-006-autenticacao-e-acesso.md).
