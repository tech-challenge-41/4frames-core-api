# Ponta a ponta

`pnpm test:e2e` contra a stack no cluster Kind local (`./scripts/k8s-local.sh up`), pelo Ingress em
http://localhost:8080, como o navegador. Os jobs são do `user@user.com`; o `admin@admin.com` faz o papel de outro
usuário.

| Cenário                                                                                                    | Resultado | Duração |
| ---------------------------------------------------------------------------------------------------------- | --------- | ------- |
| Vídeo válido: `POST /videos`, `PUT` no S3, `complete`, progresso pelo SSE até o `job.done` e status `DONE` | passou    | 18,7 s  |
| Download: zip com 30 PNGs (`frame_0001.png` a `frame_0030.png`), na ordem e na raiz                        | passou    | 0,5 s   |
| E-mail ao dono no Mailpit, com o link `/jobs/<id>` e os 30 frames                                          | passou    | 1,0 s   |
| Arquivo inválido: `FAILED` com o motivo e o e-mail de falha                                                | passou    | 4,1 s   |
| Listagem com os dois jobs: `DONE` com download e `FAILED` com o motivo                                     | passou    | 0,0 s   |
| Outro usuário recebe 404, com a mesma resposta de um job que não existe                                    | passou    | 0,1 s   |

6 de 6 cenários, em 26 s. A suíte rodou 4 vezes seguidas, todas verdes (entre 21 e 40 s).
