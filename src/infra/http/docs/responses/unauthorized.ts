export const Unauthorized = {
  description: 'Não autorizado',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorSchema' },
      example: {
        message: 'Unauthorized',
        data: {}
      }
    }
  }
};
