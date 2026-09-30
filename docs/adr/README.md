# Decisões de arquitetura (ADRs)

| ADR                                                           | Título                                                                                                 | Status                                                 | Data       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------- |
| [ADR-001](./ADR-001-arquitetura.pdf)                          | Arquitetura do 4Frames: processamento assíncrono com upload direto ao S3, fila SQS e workers elásticos | Aceito, com partes substituídas pelo ADR-002           | 2026-08-19 |
| [ADR-002](./ADR-002-execucao-local-e-monorepo.md)             | Execução local com Kubernetes e LocalStack, monorepo do backend e job com UUID                         | Aceito, com a observabilidade substituída pelo ADR-008 | 2026-09-17 |
| [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md)  | Cluster local com Kind, infraestrutura no Docker Compose e manifestos com Kustomize                    | Aceito                                                 | 2026-09-24 |
| [ADR-004](./ADR-004-escala-e-encerramento-sem-perda.md)       | Escala automática e encerramento sem perda de requisição nem de vídeo                                  | Aceito                                                 | 2026-09-23 |
| [ADR-005](./ADR-005-ciclo-de-vida-do-job.md)                  | Ciclo de vida do job: transições condicionais, cancelamento, expiração, falhas e notificação           | Aceito                                                 | 2026-09-17 |
| [ADR-006](./ADR-006-autenticacao-e-acesso.md)                 | Autenticação, autorização por dono e segredos                                                          | Aceito                                                 | 2026-08-24 |
| [ADR-007](./ADR-007-qualidade-testes-e-entrega.md)            | Qualidade, testes e entrega contínua                                                                   | Aceito                                                 | 2026-09-22 |
| [ADR-008](./ADR-008-observabilidade-opentelemetry-datadog.md) | Observabilidade com OpenTelemetry e Datadog Agent                                                      | Aceito                                                 | 2026-09-29 |

O ADR-001 é mantido no PDF original, que ainda mostra o status "Pendente". O status vigente é o desta tabela.

Como ler:

- O **ADR-001** é a arquitetura: os três planos, o fluxo ponta a ponta e as garantias.
- O **ADR-002** é o que mudou para rodar sem AWS, e a tabela do que substitui cada serviço gerenciado.
- Os **ADR-003 a ADR-008** registram as decisões tomadas na implementação, cada uma com o contexto e os trade-offs. Foram
  escritos depois: a data é a de quando a decisão entrou no código, e cada ADR diz quando as outras partes entraram.
  Por isso a numeração não segue a ordem das datas.

Um ADR aceito não é reescrito. Uma decisão nova, ou que muda outra, entra num ADR novo, que diz qual substitui. Só a
coluna de situação do ADR-002 é atualizada conforme a implementação avança.
