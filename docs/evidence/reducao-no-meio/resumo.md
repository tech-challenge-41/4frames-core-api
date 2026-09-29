# reducao-no-meio

10 vídeos ao mesmo tempo, com o KEDA limitado a 5 workers.

![Workers e vídeos ao longo do cenário](timeline.svg)

|                                                                            |                              |
| -------------------------------------------------------------------------- | ---------------------------- |
| Vídeos enviados / concluídos / com falha                                   | 10 / 10 / 0                  |
| Nenhum vídeo perdido (todos em DONE)                                       | sim                          |
| Drenagem (primeiro job criado → último concluído)                          | 111,7 s                      |
| Primeiro worker extra pedido pelo KEDA                                     | 19,7 s                       |
| Pico de workers prontos                                                    | 5                            |
| Pico de workers em encerramento                                            | 4                            |
| Workers de volta ao mínimo                                                 | 118,3 s                      |
| Uploads no k6: requisições / com erro                                      | 31 / 0                       |
| API no pico, `POST /videos`: mediana / p95                                 | 44 ms / 122 ms               |
| API no pico, `POST /videos/:jobId/complete`: mediana / p95                 | 109 ms / 151 ms              |
| `PUT` de cada vídeo no S3, todos ao mesmo tempo: mediana / p95             | 16.151 ms / 16.980 ms        |
| Listagem durante o pico (`GET /videos` a cada 3 s): requisições / com erro | 801 / 0                      |
| Listagem durante o pico: mediana / p95                                     | 7 ms / 100 ms                |
| Limites do k6 (0 erros, todos os checks)                                   | uploads: sim · listagem: sim |

Marcos (segundos desde o início):

- 0 s: início: 10 vídeos, máximo de 5 worker(s)
- 22,2 s: uploads enviados (k6 saiu com 0)
- 34 s: máximo reduzido para 1 com 5 vídeos em processamento
- 117,9 s: todos os jobs terminaram
- 118,3 s: workers de volta ao mínimo

Arquivos: `pods-watch.log` (os pods do worker, evento a evento, com o horário), `replicas.log`, `queue.csv`,
`jobs.csv`, `k6-uploads.json`/`.txt` e `k6-listagem.json`/`.txt`, e `worker-*.log`, com o log inteiro de cada worker que estava de pé na redução.
