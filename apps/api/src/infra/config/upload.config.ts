import { parseEnv } from '@4frames/shared/env';
import { z } from 'zod';

export const DEFAULT_UPLOAD_URL_TTL_SECONDS = 5 * 60;

export const uploadEnvSchema = z.object({
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(DEFAULT_UPLOAD_URL_TTL_SECONDS)
});

/** Validade da URL pré-assinada de upload. A expiração de jobs UPLOAD_PENDING usa o mesmo valor. */
export function readUploadUrlTtlSeconds(env: Record<string, string | undefined> = process.env): number {
  return parseEnv(uploadEnvSchema, env).UPLOAD_URL_TTL_SECONDS;
}
