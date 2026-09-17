import { z } from 'zod';

const authUserSchema = z.object({
  email: z.email('Email inválido'),

  password: z
    .string('Senha deve ser uma string')
    .min(6, 'Senha deve ter ao menos 6 caracteres')
    .max(30, 'Senha deve ter no máximo 30 caracteres')
});

export default authUserSchema;
