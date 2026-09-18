import {
  JOB_EVENT_TYPES,
  JOB_PROGRESS_TTL_SECONDS,
  jobChannel,
  jobProgressKey,
  JOBS_EVENTS_CHANNEL,
  serializeJobEvent
} from '@4frames/shared/jobs';
import { type Logger } from '@4frames/shared/logger';
import { type Redis } from '@4frames/shared/redis';

import { ProgressThrottle } from './job-progress';
import { toError } from '../processing/errors';
import { type JobEventPublisher, type JobRef, type ProgressReporter } from '../processing/ports';

type RedisCommands = Pick<Redis, 'publish' | 'set' | 'del'>;

export interface RedisJobEventPublisherOptions {
  redis: RedisCommands;
  logger: Logger;
  minProgressIntervalMs?: number;
  now?: () => number;
}

/**
 * Progresso em `job:{jobId}` + `progress:{jobId}` (com TTL) e eventos terminais em `job:{jobId}` e `jobs.events`.
 *
 * Tudo aqui é best-effort: o status durável já está no Postgres quando um evento é publicado (ADR-001 §2.3),
 * então uma falha do Redis é logada e não devolve a mensagem à fila. O notifier cobre eventos perdidos
 * com a varredura de jobs não notificados.
 */
export class RedisJobEventPublisher implements JobEventPublisher {
  private readonly redis: RedisCommands;
  private readonly logger: Logger;
  private readonly minProgressIntervalMs: number;
  private readonly now: () => number;

  constructor({ redis, logger, minProgressIntervalMs = 1000, now = Date.now }: RedisJobEventPublisherOptions) {
    this.redis = redis;
    this.logger = logger;
    this.minProgressIntervalMs = minProgressIntervalMs;
    this.now = now;
  }

  public createProgressReporter({ jobId, userId }: JobRef): ProgressReporter {
    const throttle = new ProgressThrottle({ minIntervalMs: this.minProgressIntervalMs, now: this.now });

    return percent => {
      const value = throttle.next(percent);

      if (value === undefined) {
        return;
      }

      // Não aguarda: o ffmpeg não pode esperar o Redis. Os comandos saem na ordem pela mesma conexão.
      void this.safely('job.progress', jobId, () => {
        const message = serializeJobEvent({ type: JOB_EVENT_TYPES.progress, jobId, userId, percent: value });

        return Promise.all([
          this.redis.set(jobProgressKey(jobId), String(value), 'EX', JOB_PROGRESS_TTL_SECONDS),
          this.redis.publish(jobChannel(jobId), message)
        ]);
      });
    };
  }

  public async publishDone({ jobId, userId, zipKey, frameCount }: JobRef & { zipKey: string; frameCount: number }) {
    await this.safely('job.done', jobId, () => {
      const message = serializeJobEvent({ type: JOB_EVENT_TYPES.done, jobId, userId, zipKey, frameCount });

      return Promise.all([
        this.redis.set(jobProgressKey(jobId), '100', 'EX', JOB_PROGRESS_TTL_SECONDS),
        this.redis.publish(jobChannel(jobId), message),
        this.redis.publish(JOBS_EVENTS_CHANNEL, message)
      ]);
    });
  }

  public async publishFailed({ jobId, userId, reason }: JobRef & { reason: string }) {
    await this.safely('job.failed', jobId, () => {
      const message = serializeJobEvent({ type: JOB_EVENT_TYPES.failed, jobId, userId, reason });

      return Promise.all([
        this.redis.del(jobProgressKey(jobId)),
        this.redis.publish(jobChannel(jobId), message),
        this.redis.publish(JOBS_EVENTS_CHANNEL, message)
      ]);
    });
  }

  private async safely(eventType: string, jobId: string, action: () => Promise<unknown>): Promise<void> {
    // action é chamada dentro do try: um erro síncrono (ex.: evento inválido) também só vira log.
    try {
      await action();
    } catch (error) {
      this.logger.warn('Failed to publish job event to Redis', {
        eventType,
        jobId,
        error: toError(error).message
      });
    }
  }
}
