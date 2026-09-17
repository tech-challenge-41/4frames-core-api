export const ErrorSchema = {
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: {
      type: 'string',
      description: 'Mensagem do erro'
    },
    data: {
      type: 'object',
      description: 'Dados do erro'
    }
  }
};
