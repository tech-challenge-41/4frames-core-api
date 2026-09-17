export const getVideoJobStatusPath = {
  '/videos/{jobId}': {
    get: {
      tags: ['video'],
      summary: 'Consultar status de um job de upload de vídeo',
      description: 'Retorna o status atual do job, autorizado apenas para o usuário dono do job',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'jobId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Identificador do job (UUID)'
        }
      ],
      responses: {
        200: {
          description: 'Status do job',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jobId: {
                    type: 'string',
                    format: 'uuid',
                    description: 'Identificador do job (UUID)'
                  },
                  status: {
                    type: 'string',
                    enum: ['UPLOAD_PENDING', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'EXPIRED'],
                    description: 'Status atual do job'
                  },
                  fileName: {
                    type: 'string',
                    description: 'Nome do arquivo enviado'
                  },
                  failureReason: {
                    type: 'string',
                    description: 'Motivo da falha, presente apenas quando status é FAILED'
                  }
                }
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' }
      }
    }
  }
};
