import { jobChannel, jobProgressKey, JOB_EVENT_TYPES, parseJobEvent, type JobEvent } from '@4frames/shared/jobs';
import { createRedisClient } from '@4frames/shared/redis';

import {
  type IJobEventSubscriber,
  type JobEventSubscription
} from '@/domain/ports/service/job-event-subscriber.service.interface';
import { type ILogger } from '@/domain/ports/service/logger.interface';

export interface RedisJobEventSubscriberOptions {
  logger: ILogger;
}

/**
 * Um cliente Redis dedicado por assinatura (não o singleton compartilhado): em modo subscriber a
 * conexão ioredis para de aceitar outros comandos, então GET/outros usos do Redis na API não podem
 * dividir a conexão com SUBSCRIBE (ver comentário em packages/shared/src/redis/index.ts).
 */
export class RedisJobEventSubscriberService implements IJobEventSubscriber {
  private readonly logger: ILogger;

  constructor({ logger }: RedisJobEventSubscriberOptions) {
    this.logger = logger.child({ component: RedisJobEventSubscriberService.name });
  }

  public async subscribe(
    jobId: string,
    userId: number,
    onEvent: (event: JobEvent) => void
  ): Promise<JobEventSubscription> {
    const client = createRedisClient();

    let unsubscribed = false;

    client.on('error', error => {
      this.logger.warn('Redis subscriber connection error', { jobId, error: error.message });
    });

    client.on('message', (channel: string, raw: string) => {
      if (channel !== jobChannel(jobId)) {
        return;
      }

      const event = parseJobEvent(raw);

      if (!event) {
        this.logger.warn('Discarding malformed job event message', { jobId });
        return;
      }

      onEvent(event);
    });

    // Lê o progresso atual ANTES de assinar: uma vez em modo subscriber este cliente não aceita mais GET.
    const currentProgress = await client.get(jobProgressKey(jobId));

    await client.subscribe(jobChannel(jobId));

    if (currentProgress !== null) {
      const percent = Number(currentProgress);

      if (Number.isFinite(percent)) {
        onEvent({ type: JOB_EVENT_TYPES.progress, jobId, userId, percent });
      }
    }

    return {
      unsubscribe: async () => {
        if (unsubscribed) {
          return;
        }

        unsubscribed = true;

        try {
          await client.quit();
        } catch (error) {
          this.logger.warn('Failed to close Redis subscriber connection cleanly', {
            jobId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };
  }
}
