# 1-worker

10 vídeos ao mesmo tempo, com o KEDA limitado a 1 worker.

![Workers e vídeos ao longo do cenário](timeline.svg)

|                                                                            |                              |
| -------------------------------------------------------------------------- | ---------------------------- |
| Vídeos enviados / concluídos / com falha                                   | 10 / 10 / 0                  |
| Nenhum vídeo perdido (todos em DONE)                                       | sim                          |
| Drenagem (primeiro job criado → último concluído)                          | 126,4 s                      |
| Primeiro worker extra pedido pelo KEDA                                     | –                            |
| Pico de workers prontos                                                    | 1                            |
| Pico de workers em encerramento                                            | 0                            |
| Workers de volta ao mínimo                                                 | 131,1 s                      |
| Uploads no k6: requisições / com erro                                      | 31 / 0                       |
| API no pico, `POST /videos`: mediana / p95                                 | 45 ms / 173 ms               |
| API no pico, `POST /videos/:jobId/complete`: mediana / p95                 | 65 ms / 124 ms               |
| `PUT` de cada vídeo no S3, todos ao mesmo tempo: mediana / p95             | 15.435 ms / 15.766 ms        |
| Listagem durante o pico (`GET /videos` a cada 3 s): requisições / com erro | 801 / 0                      |
| Listagem durante o pico: mediana / p95                                     | 7 ms / 75 ms                 |
| Limites do k6 (0 erros, todos os checks)                                   | uploads: sim · listagem: sim |

Marcos (segundos desde o início):

- 0 s: início: 10 vídeos, máximo de 1 worker(s)
- 19,5 s: uploads enviados (k6 saiu com 0)
- 130,6 s: todos os jobs terminaram
- 131,1 s: workers de volta ao mínimo

Arquivos: `pods-watch.log` (os pods do worker, evento a evento, com o horário), `replicas.log`, `queue.csv`,
`jobs.csv`, `k6-uploads.json`/`.txt` e `k6-listagem.json`/`.txt`.
