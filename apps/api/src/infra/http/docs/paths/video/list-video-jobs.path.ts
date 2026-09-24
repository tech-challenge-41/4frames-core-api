export const listVideoJobsPath = {
  '/videos': {
    get: {
      tags: ['video'],
      summary: 'Listar os jobs de vídeo do usuário autenticado',
      description:
        'Retorna os jobs do usuário logado, paginados por offset/limit, mais recentes primeiro (created_at desc)',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          description: 'Quantidade máxima de jobs por página'
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
          description: 'Quantidade de jobs a pular a partir do mais recente'
        }
      ],
      responses: {
        200: {
          description: 'Lista paginada de jobs do usuário',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        jobId: {
                          type: 'string',
                          format: 'uuid',
                          description: 'Identificador do job (UUID)'
                        },
                        fileName: {
                          type: 'string',
                          description: 'Nome do arquivo enviado'
                        },
                        status: {
                          type: 'string',
                          enum: ['UPLOAD_PENDING', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'EXPIRED'],
                          description: 'Status atual do job'
                        },
                        createdAt: {
                          type: 'string',
                          format: 'date-time',
                          description: 'Momento de criação do job'
                        },
                        failureReason: {
                          type: 'string',
                          description: 'Motivo da falha, presente apenas quando status é FAILED'
                        },
                        hasDownload: {
                          type: 'boolean',
                          description:
                            'true quando o job está DONE e tem um .zip disponível em GET /videos/{jobId}/download'
                        }
                      }
                    }
                  },
                  total: {
                    type: 'number',
                    description: 'Total de jobs do usuário, independente da paginação'
                  },
                  limit: {
                    type: 'number',
                    description: 'Limite aplicado nesta página'
                  },
                  offset: {
                    type: 'number',
                    description: 'Offset aplicado nesta página'
                  }
                }
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  }
};
