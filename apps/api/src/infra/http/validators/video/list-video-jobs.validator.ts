import { z } from 'zod';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';

export const DEFAULT_LIST_VIDEO_JOBS_LIMIT = 20;
export const MAX_LIST_VIDEO_JOBS_LIMIT = 100;

const listVideoJobsQuerySchema = z.object({
  limit: z.coerce
    .number('Limite deve ser um número')
    .int('Limite deve ser um número inteiro')
    .positive('Limite deve ser maior que zero')
    .max(MAX_LIST_VIDEO_JOBS_LIMIT, `Limite máximo é ${MAX_LIST_VIDEO_JOBS_LIMIT}`)
    .default(DEFAULT_LIST_VIDEO_JOBS_LIMIT),

  offset: z.coerce
    .number('Offset deve ser um número')
    .int('Offset deve ser um número inteiro')
    .min(0, 'Offset não pode ser negativo')
    .default(0)
});

export interface ListVideoJobsQuery {
  limit: number;
  offset: number;
}

/**
 * Valida os query params de GET /videos (paginação por offset/limit). Um valor malformado
 * vira 400 antes de chegar ao banco, mesmo padrão de parseJobIdParam para o :jobId de rota.
 */
export function parseListVideoJobsQuery(query: unknown): ListVideoJobsQuery {
  const result = listVideoJobsQuerySchema.safeParse(query);

  if (!result.success) {
    throw new InvalidRequestParamError('Invalid pagination parameters', { query });
  }

  return result.data;
}
