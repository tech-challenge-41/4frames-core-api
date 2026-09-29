# keda-ate-5

10 vídeos ao mesmo tempo, com o KEDA limitado a 5 workers.

![Workers e vídeos ao longo do cenário](timeline.svg)

|                                                                            |                              |
| -------------------------------------------------------------------------- | ---------------------------- |
| Vídeos enviados / concluídos / com falha                                   | 10 / 10 / 0                  |
| Nenhum vídeo perdido (todos em DONE)                                       | sim                          |
| Drenagem (primeiro job criado → último concluído)                          | 100 s                        |
| Primeiro worker extra pedido pelo KEDA                                     | 18,5 s                       |
| Pico de workers prontos                                                    | 5                            |
| Pico de workers em encerramento                                            | 2                            |
| Workers de volta ao mínimo                                                 | 126,6 s                      |
| Uploads no k6: requisições / com erro                                      | 31 / 0                       |
| API no pico, `POST /videos`: mediana / p95                                 | 118 ms / 495 ms              |
| API no pico, `POST /videos/:jobId/complete`: mediana / p95                 | 38 ms / 157 ms               |
| `PUT` de cada vídeo no S3, todos ao mesmo tempo: mediana / p95             | 15.982 ms / 16.843 ms        |
| Listagem durante o pico (`GET /videos` a cada 3 s): requisições / com erro | 794 / 0                      |
| Listagem durante o pico: mediana / p95                                     | 7 ms / 113 ms                |
| Limites do k6 (0 erros, todos os checks)                                   | uploads: sim · listagem: sim |

Marcos (segundos desde o início):

- 0 s: início: 10 vídeos, máximo de 5 worker(s)
- 21,9 s: uploads enviados (k6 saiu com 0)
- 103,6 s: todos os jobs terminaram
- 126,6 s: workers de volta ao mínimo

Arquivos: `pods-watch.log` (os pods do worker, evento a evento, com o horário), `replicas.log`, `queue.csv`,
`jobs.csv`, `k6-uploads.json`/`.txt` e `k6-listagem.json`/`.txt`.
