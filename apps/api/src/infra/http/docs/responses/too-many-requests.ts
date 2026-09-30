export const TooManyRequests = {
  description: 'Limite de requisições excedido',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorSchema' },
      example: {
        message: 'Muitas requisições da mesma fonte, tente novamente mais tarde.',
        error: 'TOO_MANY_REQUESTS'
      }
    }
  }
};
