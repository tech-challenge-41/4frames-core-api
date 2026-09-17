import { parseVideoSourceKey } from '@4frames/shared/jobs';
import { z } from 'zod';

export interface JobSourceKey {
  jobId: string;
  userId: number;
  extension: string;
}

const uuidSchema = z.uuid();

/**
 * Lê dono e job da chave `videos/{userId}/{jobId}/source.{ext}` (ADR-001 §2.2, passo 4).
 * Devolve `null` para chaves fora do padrão, jobId que não é UUID ou userId que não é inteiro positivo.
 */
export function parseJobSourceKey(key: string): JobSourceKey | null {
  const parts = parseVideoSourceKey(key);

  if (!parts || !uuidSchema.safeParse(parts.jobId).success || !/^[1-9]\d*$/.test(parts.userId)) {
    return null;
  }

  const userId = Number(parts.userId);

  if (!Number.isSafeInteger(userId)) {
    return null;
  }

  return { jobId: parts.jobId.toLowerCase(), userId, extension: parts.extension };
}
