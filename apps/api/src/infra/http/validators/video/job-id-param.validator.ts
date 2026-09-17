import { z } from 'zod';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';

export const jobIdParamSchema = z.uuid();

/**
 * Valida o parâmetro de rota `:jobId` (UUID). Um id malformado vira 400 antes de chegar ao banco,
 * que rejeitaria o valor ao converter para o tipo uuid.
 */
export function parseJobIdParam(jobId: unknown): string {
  const result = jobIdParamSchema.safeParse(jobId);

  if (!result.success) {
    throw new InvalidRequestParamError('jobId must be a valid UUID', { jobId });
  }

  return result.data;
}
