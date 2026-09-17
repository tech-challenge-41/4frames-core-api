export const healthCheckPath = {
  '/health-check': {
    get: {
      tags: ['system'],
      summary: 'Health check',
      description: 'Verifica se o servidor está em execução',
      security: [],
      responses: {
        200: {
          description: 'Servidor em execução',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }
};
