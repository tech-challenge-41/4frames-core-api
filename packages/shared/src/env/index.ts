import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

const MONOREPO_ROOT_MARKER = 'pnpm-workspace.yaml';

/**
 * Procura o arquivo de env subindo a partir de `startDir` até a raiz do monorepo
 * (pasta que contém `pnpm-workspace.yaml`). Não sobe além dela.
 */
export function findEnvFile(startDir: string = process.cwd(), fileName = '.env'): string | undefined {
  let current = path.resolve(startDir);

  for (;;) {
    const candidate = path.join(current, fileName);

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (fs.existsSync(path.join(current, MONOREPO_ROOT_MARKER)) || parent === current) {
      return undefined;
    }

    current = parent;
  }
}

export interface LoadEnvOptions {
  startDir?: string;
  fileName?: string;
}

/**
 * Carrega o `.env` mais próximo (normalmente o da raiz do monorepo) em `process.env`.
 * Variáveis já definidas no ambiente (Compose, CI) têm precedência e não são sobrescritas.
 */
export function loadEnv({ startDir, fileName }: LoadEnvOptions = {}): string | undefined {
  const envFile = findEnvFile(startDir, fileName);

  if (envFile) {
    dotenv.config({ path: envFile, quiet: true });
  }

  return envFile;
}

export class EnvValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment variables: ${issues.join('; ')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env
): z.infer<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    );
  }

  return result.data;
}

export const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional()
});

export const awsEnvSchema = z.object({
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ENDPOINT_URL: z.url().optional()
});

export const s3EnvSchema = awsEnvSchema.extend({
  S3_BUCKET_NAME: z.string().min(1)
});

export const sqsEnvSchema = awsEnvSchema.extend({
  SQS_QUEUE_URL: z.url(),
  SQS_DLQ_URL: z.url().optional()
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ })
});
