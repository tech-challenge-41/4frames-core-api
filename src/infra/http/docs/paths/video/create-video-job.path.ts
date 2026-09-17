import { z } from 'zod';

import createVideoJobSchema from '../../../validators/video/create-video-job.validator';

export const createVideoJobPath = {
  '/videos': {
    post: {
      tags: ['video'],
      summary: 'Solicitar upload de vídeo',
      description:
        'Cria um job de upload de vídeo com status inicial UPLOAD_PENDING e devolve uma URL pré-assinada de PUT para o S3',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.toJSONSchema(createVideoJobSchema, {
              target: 'openapi-3.0'
            })
          }
        }
      },
      responses: {
        201: {
          description: 'Job de upload criado com sucesso',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jobId: {
                    type: 'number',
                    description: 'Identificador do job de upload'
                  },
                  uploadUrl: {
                    type: 'string',
                    description: 'URL pré-assinada de PUT para upload direto ao S3'
                  },
                  expiresIn: {
                    type: 'number',
                    description: 'Validade da URL pré-assinada em segundos'
                  }
                }
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/BadRequest' }
      }
    }
  }
};
