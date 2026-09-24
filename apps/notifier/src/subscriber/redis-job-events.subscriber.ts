import { JOBS_EVENTS_CHANNEL, parseJobEvent } from '@4frames/shared/jobs';
import { type Logger } from '@4frames/shared/logger';
import { createRedisClient, type Redis } from '@4frames/shared/redis';

import { type NotifyVideoJobTerminalUseCase } from '@/application/notify-video-job-terminal.usecase';

export interface RedisJobEventsSubscriberOptions {
  redisUrl: string;
  useCase: NotifyVideoJobTerminalUseCase;
  logger: Logger;
}

export class RedisJobEventsSubscriber {
  private readonly redisUrl: string;
  private readonly useCase: NotifyVideoJobTerminalUseCase;
  private readonly logger: Logger;
  private client?: Redis;
  private stopping = false;

  constructor({ redisUrl, useCase, logger }: RedisJobEventsSubscriberOptions) {
    this.redisUrl = redisUrl;
    this.useCase = useCase;
    this.logger = logger.child({ component: RedisJobEventsSubscriber.name });
  }

  public async start(): Promise<void> {
    this.client = createRedisClient(this.redisUrl);
    this.stopping = false;

    this.client.on('error', error => {
      this.logger.warn('Redis subscriber connection error', { error: error.message });
    });

    this.client.on('message', (channel, raw) => {
      if (channel !== JOBS_EVENTS_CHANNEL) {
        return;
      }

      void this.handleMessage(raw);
    });

    await this.client.subscribe(JOBS_EVENTS_CHANNEL);
    this.logger.info('Subscribed to Redis channel', { channel: JOBS_EVENTS_CHANNEL });
  }

  public isAlive(): boolean {
    if (this.stopping) {
      return true;
    }

    return this.client !== undefined && this.client.status !== 'end';
  }

  public async stop(): Promise<void> {
    this.stopping = true;

    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn('Failed to close Redis subscriber cleanly', {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.client = undefined;
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    if (this.stopping) {
      return;
    }

    const event = parseJobEvent(raw);

    if (!event) {
      this.logger.warn('Discarding malformed job event on jobs.events');
      return;
    }

    try {
      await this.useCase.fromRedisEvent(event);
    } catch (error) {
      this.logger.error('Failed to process job event notification', error instanceof Error ? error : undefined, {
        jobId: event.jobId,
        eventType: event.type,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
