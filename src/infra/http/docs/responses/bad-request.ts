export const BadRequest = {
  description: 'Erro de validação ou argumento inválido',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorSchema' },
      example: {
        message: 'Invalid argument',
        data: { field: 'email' }
      }
    }
  }
};
