import { z } from 'zod';

import { type JobId } from './storage-keys';

export const JOB_EVENT_TYPES = {
  progress: 'job.progress',
  done: 'job.done',
  failed: 'job.failed'
} as const;

/** Canal global com eventos terminais de todos os jobs (assinado pelo notifier). */
export const JOBS_EVENTS_CHANNEL = 'jobs.events';

/** TTL do último percentual gravado em `progress:{jobId}`. */
export const JOB_PROGRESS_TTL_SECONDS = 60 * 60;

/** Canal Pub/Sub de um job (progresso e eventos terminais, retransmitidos pela API via SSE). */
export function jobChannel(jobId: JobId): string {
  return `job:${jobId}`;
}

/** Chave com o último percentual conhecido do job. */
export function jobProgressKey(jobId: JobId): string {
  return `progress:${jobId}`;
}

const jobRef = {
  jobId: z.uuid(),
  userId: z.number().int().positive()
};

export const jobProgressEventSchema = z.object({
  type: z.literal(JOB_EVENT_TYPES.progress),
  ...jobRef,
  percent: z.number().min(0).max(100)
});

export const jobDoneEventSchema = z.object({
  type: z.literal(JOB_EVENT_TYPES.done),
  ...jobRef,
  zipKey: z.string().min(1),
  frameCount: z.number().int().nonnegative()
});

export const jobFailedEventSchema = z.object({
  type: z.literal(JOB_EVENT_TYPES.failed),
  ...jobRef,
  reason: z.string().min(1)
});

export const jobEventSchema = z.discriminatedUnion('type', [
  jobProgressEventSchema,
  jobDoneEventSchema,
  jobFailedEventSchema
]);

export type JobProgressEvent = z.infer<typeof jobProgressEventSchema>;
export type JobDoneEvent = z.infer<typeof jobDoneEventSchema>;
export type JobFailedEvent = z.infer<typeof jobFailedEventSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;

export function serializeJobEvent(event: JobEvent): string {
  return JSON.stringify(jobEventSchema.parse(event));
}

/** Converte a mensagem recebida do Redis. Mensagens malformadas viram `null`, nunca exceção. */
export function parseJobEvent(raw: string): JobEvent | null {
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = jobEventSchema.safeParse(payload);

  return result.success ? result.data : null;
}
