const readinessSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'unavailable'] },
    checks: {
      type: 'object',
      description: 'Estado de cada dependência',
      properties: {
        database: { type: 'string', enum: ['up', 'down'] },
        redis: { type: 'string', enum: ['up', 'down'] }
      }
    }
  }
};

export const readinessPath = {
  '/ready': {
    get: {
      tags: ['system'],
      summary: 'Readiness',
      description:
        'Verifica se a API consegue atender: Postgres (SELECT 1) e Redis (PING), cada um com prazo de 2 s. ' +
        'É a readiness probe do Kubernetes; `/health-check` só diz que o processo está de pé (liveness).',
      security: [],
      responses: {
        200: {
          description: 'Todas as dependências responderam',
          content: { 'application/json': { schema: readinessSchema } }
        },
        503: {
          description: 'Alguma dependência não respondeu; a réplica sai do balanceamento',
          content: { 'application/json': { schema: readinessSchema } }
        }
      }
    }
  }
};
