export const getVideoJobDownloadUrlPath = {
  '/videos/{jobId}/download': {
    get: {
      tags: ['video'],
      summary: 'Obter URL de download do resultado de um job de vídeo',
      description:
        'Retorna uma URL pré-assinada de download do .zip gerado, autorizado apenas para o usuário dono do job e apenas quando o status é DONE',
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
          description: 'URL pré-assinada de download',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  downloadUrl: {
                    type: 'string',
                    format: 'uri',
                    description: 'URL pré-assinada para baixar o .zip do S3'
                  },
                  expiresIn: {
                    type: 'number',
                    description: 'Validade da URL em segundos'
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
