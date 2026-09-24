export const cancelVideoJobPath = {
  '/videos/{jobId}/cancel': {
    post: {
      tags: ['video'],
      summary: 'Cancelar um job de vídeo pendente ou enfileirado',
      description:
        'Cancela o job (marcado como EXPIRED) enquanto ele ainda está em UPLOAD_PENDING ou QUEUED. Escrita ' +
        'condicional ao status atual: se o worker já começou a processar, retorna 422',
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
          description: 'Job cancelado',
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
                    enum: ['EXPIRED'],
                    description: 'Status atual do job após cancelamento'
                  }
                }
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        422: { $ref: '#/components/responses/BadRequest' }
      }
    }
  }
};
