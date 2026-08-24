import { z } from 'zod';

import authUserSchema from '../../../validators/auth/auth-user.validator';

export const authenticatePath = {
  '/auth': {
    post: {
      tags: ['auth'],
      summary: 'Autenticar usuário',
      description: 'Autentica usuário por email e senha e retorna JWT',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.toJSONSchema(authUserSchema, {
              target: 'openapi-3.0'
            })
          }
        }
      },
      responses: {
        201: {
          description: 'Autenticação realizada com sucesso',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accessToken: {
                    type: 'string',
                    description: 'Token JWT para autenticação'
                  },
                  expireIn: {
                    type: 'number',
                    description: 'Tempo de expiração do token em segundos'
                  },
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      email: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/TooManyRequests' }
      }
    }
  }
};
