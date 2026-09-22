import os from 'node:os';
import path from 'node:path';

import { redisEnvSchema, runtimeEnvSchema, s3EnvSchema, sqsEnvSchema } from '@4frames/shared/env';
import { z } from 'zod';

export const FRAME_FORMATS = ['png', 'jpg'] as const;

export type FrameFormat = (typeof FRAME_FORMATS)[number];

export const workerEnvSchema = runtimeEnvSchema
  .extend(s3EnvSchema.shape)
  .extend(sqsEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend({
    /** Visibilidade pedida a cada recebimento; o worker renova na metade do tempo enquanto processa. */
    VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(43_200).default(600),
    /** Regra do projeto base: `-vf fps=1`. */
    FRAME_FPS: z.coerce.number().positive().max(60).default(1),
    /** Regra do projeto base: PNG. */
    FRAME_FORMAT: z.enum(FRAME_FORMATS).default('png'),
    MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
    /** No cluster é um volume emptyDir. */
    WORKER_TMP_DIR: z.preprocess(
      value => (value === '' ? undefined : value),
      z.string().default(path.join(os.tmpdir(), '4frames'))
    ),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(9100),
    /** Tempo para terminar o job atual depois do SIGTERM. Fica abaixo do stop_grace_period / terminationGracePeriodSeconds. */
    WORKER_SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(570),
    /** Limite de uma execução do ffmpeg; ao estourar, o processo é morto e o job volta à fila. */
    FFMPEG_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
    /**
     * Quantos consumidores SQS da fila de uploads rodam no mesmo processo (um job por consumidor).
     * Para mais paralelismo em produção, prefira réplicas do Deployment (KEDA); localmente isso evita `docker compose scale`.
     */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2)
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
