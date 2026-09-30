# Evidências: ponta a ponta, carga e escala

Resultados gerados pelos testes de `tests/e2e` e `tests/load` (ver "Testes ponta a ponta e de carga" no
[README](../../README.md)), contra a stack no cluster Kind local, pelo Ingress em http://localhost:8080.

**Ambiente:** Windows 11 com Docker Desktop (8 CPUs e 11,5 GB para a VM), um cluster Kind de um nó, e Postgres,
Redis, LocalStack e Mailpit no Compose. O vídeo é o `ex-30sec-video.mp4` dos testes do worker (30 s, 34 MB, 30
frames). Cada worker processa um vídeo por vez e tem até 2 CPUs.

| Pasta                                          | O que prova                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [e2e](./e2e/resumo.md)                         | O fluxo completo pelo navegador: upload, SSE, zip, e-mail, falha, listagem e isolamento por dono |
| [1-worker](./1-worker/resumo.md)               | O pico com o KEDA limitado a 1 réplica, o equivalente a um worker fixo                           |
| [keda-ate-5](./keda-ate-5/resumo.md)           | O pico com o KEDA livre de 1 a 5 workers: escala pela fila e volta ao mínimo                     |
| [reducao-no-meio](./reducao-no-meio/resumo.md) | Scale-down com 5 vídeos em processamento: 4 workers saem só depois de terminar o vídeo           |

## Os três cenários de carga

Em cada um, 10 vídeos enviados ao mesmo tempo pelo k6, como pelo front (`POST /videos`, `PUT` no S3 e `complete`),
e 10 usuários consultando a listagem a cada 3 s durante todo o cenário.

|                                             | 1-worker  | keda-ate-5 | reducao-no-meio |
| ------------------------------------------- | --------- | ---------- | --------------- |
| Vídeos concluídos                           | 10 de 10  | 10 de 10   | 10 de 10        |
| Requisições com erro (uploads + listagem)   | 0 de 832  | 0 de 825   | 0 de 832        |
| Workers no pico                             | 1         | 5          | 5, reduzido a 1 |
| Primeiro worker extra pedido pelo KEDA      | –         | 18,5 s     | 19,7 s          |
| Vídeos em processamento ao mesmo tempo      | 1         | 5          | 5               |
| Último vídeo concluído (desde o início)     | 128,7 s   | 102,7 s    | 115,3 s         |
| Espera média por vídeo (criado → concluído) | 76 s      | 77,5 s     | 71,1 s          |
| `GET /videos` durante o pico: mediana / p95 | 7 / 75 ms | 7 / 113 ms | 7 / 100 ms      |

### O que os números mostram

- **Nenhuma requisição perdida, nenhum vídeo perdido.** Nos três cenários, as 2.489 requisições do k6 responderam sem
  erro, e os 30 vídeos chegaram a `DONE`. A contagem vem do banco, pelos jobs de cada execução.
- **Vários vídeos ao mesmo tempo e escala automática.** Com o KEDA livre, o 2º worker foi pedido 18,5 s depois do
  início, assim que as primeiras mensagens chegaram à fila, e os 5 estavam prontos aos 40 s. Com a fila vazia, as
  réplicas voltaram a 1 sozinhas. O gráfico `keda-ate-5/timeline.svg` mostra as duas coisas lado a lado.
- **Scale-down no meio do processamento.** Aos 34 s, com 5 vídeos em processamento, o máximo do KEDA caiu para 1. Os 4
  workers que saíram receberam o SIGTERM cerca de 9 s depois de começar o vídeo. Cada um terminou o vídeo, uns 27 s
  depois, e só então encerrou. Isso está nos `worker-*.log` e no `pods-watch.log` de `reducao-no-meio`. Nenhum vídeo
  voltou à fila nem se perdeu.
- **O ganho de vazão é limitado por uma máquina só.** Com 5 workers, o último vídeo terminou cerca de 20 % antes, mas a
  espera média por vídeo quase não mudou: 5 vídeos em paralelo levam cerca de 3 vezes mais, cada um, do que um
  sozinho. Os workers dividem os mesmos 8 CPUs com o resto da stack, e o LocalStack é um processo só servindo todo o
  S3 (download do vídeo, frames e zip). A pressão de memória no host durante as medições também pesou. Num cluster
  com mais nós, cada worker teria o próprio CPU. Esse é o limite que o README já registra: réplicas além dos núcleos
  da máquina não aceleram nada.
- **O `PUT` de 34 MB no S3 leva cerca de 16 s** com 10 uploads simultâneos. Os bytes não passam pela API, que
  respondeu `POST /videos` e `complete` com p95 abaixo de 0,5 s no pico.

## Como ler cada pasta de cenário

- `resumo.md`: os números e os marcos do cenário.
- `timeline.svg`: workers (prontos e em encerramento) e vídeos (na fila, em processamento e concluídos) ao longo do
  tempo, com os marcos numerados.
- `pods-watch.log`: o `kubectl get pods -w` dos workers, evento a evento, com o horário. É o que aparece no vídeo de
  entrega.
- `replicas.log`, `queue.csv`, `pods-events.log` e `jobs.csv`: os dados brutos do gráfico.
- `k6-uploads.*` e `k6-listagem.*`: a saída e o resumo JSON do k6.
- `worker-*.log`, só em `reducao-no-meio`: o log inteiro de cada worker que estava de pé na redução.
