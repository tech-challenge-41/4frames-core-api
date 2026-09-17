export const NotFound = {
  description: 'Recurso não encontrado',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorSchema' },
      example: {
        message: 'Video job not found',
        data: {}
      }
    }
  }
};
