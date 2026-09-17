export const completeVideoJobPath = {
  '/videos/{jobId}/complete': {
    post: {
      tags: ['video'],
      summary: 'Confirmar upload de vídeo concluído',
      description:
        'Confirma no S3 (HEAD Object) que o upload direto foi concluído e avança o job de UPLOAD_PENDING para QUEUED',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'jobId',
          in: 'path',
          required: true,
          schema: { type: 'integer', minimum: 1 },
          description: 'Identificador numérico do job'
        }
      ],
      responses: {
        200: {
          description: 'Job confirmado e enfileirado',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jobId: {
                    type: 'number',
                    description: 'Identificador do job'
                  },
                  status: {
                    type: 'string',
                    enum: ['QUEUED'],
                    description: 'Status atual do job após confirmação'
                  },
                  fileName: {
                    type: 'string',
                    description: 'Nome do arquivo enviado'
                  }
                }
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        412: { $ref: '#/components/responses/BadRequest' },
        422: { $ref: '#/components/responses/BadRequest' }
      }
    }
  }
};
