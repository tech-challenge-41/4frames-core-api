import { JOB_EVENT_TYPES, JOBS_EVENTS_CHANNEL } from '@4frames/shared/jobs';
import { type Logger } from '@4frames/shared/logger';
import { createRedisClient, type Redis } from '@4frames/shared/redis';

import { type NotifyVideoJobTerminalUseCase } from '@/application/notify-video-job-terminal.usecase';

import { RedisJobEventsSubscriber } from './redis-job-events.subscriber';

jest.mock('@4frames/shared/redis', () => ({ createRedisClient: jest.fn() }));

const createRedisClientMock = createRedisClient as jest.MockedFunction<typeof createRedisClient>;

const JOB_ID = '11111111-1111-4111-8111-111111111111';

const doneEvent = {
  type: JOB_EVENT_TYPES.done,
  jobId: JOB_ID,
  userId: 1,
  zipKey: `zips/1/${JOB_ID}.zip`,
  frameCount: 30
};

function createFakeRedis() {
  return {
    status: 'ready',
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK')
  };
}

function createFakeLogger(): jest.Mocked<Logger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);

  return logger;
}

/** Devolve o handler que o subscriber registrou no cliente para o evento dado. */
function handlerFor<T extends (...args: never[]) => void>(
  client: ReturnType<typeof createFakeRedis>,
  event: string
): T {
  const call = client.on.mock.calls.find(([name]) => name === event);

  if (!call) {
    throw new Error(`No handler registered for "${event}"`);
  }

  return call[1] as T;
}

/** O handler de mensagem dispara o use case sem esperar (`void`): deixa a promise assentar. */
async function flushPromises(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('RedisJobEventsSubscriber', () => {
  const useCase: jest.Mocked<Pick<NotifyVideoJobTerminalUseCase, 'fromRedisEvent'>> = { fromRedisEvent: jest.fn() };

  let logger: jest.Mocked<Logger>;
  let client: ReturnType<typeof createFakeRedis>;
  let subscriber: RedisJobEventsSubscriber;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createFakeLogger();
    useCase.fromRedisEvent.mockResolvedValue(undefined);
    client = createFakeRedis();
    createRedisClientMock.mockReturnValue(client as unknown as Redis);
    subscriber = new RedisJobEventsSubscriber({
      redisUrl: 'redis://localhost:6379',
      useCase: useCase as unknown as NotifyVideoJobTerminalUseCase,
      logger
    });
  });

  it('should not report itself alive before subscribing', () => {
    expect(subscriber.isAlive()).toBe(false);
  });

  it('should subscribe to the global job events channel on start', async () => {
    await subscriber.start();

    expect(client.subscribe).toHaveBeenCalledWith(JOBS_EVENTS_CHANNEL);
    expect(subscriber.isAlive()).toBe(true);
  });

  it.each(['connecting', 'reconnecting'])('should stay alive while the connection is %s', async status => {
    await subscriber.start();
    client.status = status;

    // O ioredis reconecta sozinho: derrubar o pod no meio disso só atrasa a volta.
    expect(subscriber.isAlive()).toBe(true);
  });

  it('should report itself unavailable when the connection ended for good', async () => {
    await subscriber.start();
    client.status = 'end';

    expect(subscriber.isAlive()).toBe(false);
  });

  it('should stay alive during graceful shutdown', async () => {
    await subscriber.start();

    await subscriber.stop();

    // A probe não pode matar um pod que já está saindo por conta própria.
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(subscriber.isAlive()).toBe(true);
  });

  it('should be safe to stop before starting', async () => {
    await expect(subscriber.stop()).resolves.toBeUndefined();
    expect(client.quit).not.toHaveBeenCalled();
  });

  it('should still finish stopping when the connection does not close cleanly', async () => {
    await subscriber.start();
    client.quit.mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(subscriber.stop()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith('Failed to close Redis subscriber cleanly', {
      error: 'Connection is closed.'
    });
    await subscriber.stop();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('should log connection errors instead of crashing the process', async () => {
    await subscriber.start();

    handlerFor<(error: Error) => void>(client, 'error')(new Error('ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalledWith('Redis subscriber connection error', { error: 'ECONNREFUSED' });
  });

  describe('messages', () => {
    let onMessage: (channel: string, raw: string) => void;

    beforeEach(async () => {
      await subscriber.start();
      onMessage = handlerFor(client, 'message');
    });

    it('should hand a terminal event on jobs.events to the use case', async () => {
      onMessage(JOBS_EVENTS_CHANNEL, JSON.stringify(doneEvent));
      await flushPromises();

      expect(useCase.fromRedisEvent).toHaveBeenCalledWith(doneEvent);
    });

    it('should ignore messages from other channels', async () => {
      onMessage(`job:${JOB_ID}`, JSON.stringify(doneEvent));
      await flushPromises();

      expect(useCase.fromRedisEvent).not.toHaveBeenCalled();
    });

    it.each([
      ['invalid JSON', '{not json'],
      ['an unknown event shape', JSON.stringify({ type: 'job.done', jobId: 'not-a-uuid' })]
    ])('should discard %s', async (_label, raw) => {
      onMessage(JOBS_EVENTS_CHANNEL, raw);
      await flushPromises();

      expect(useCase.fromRedisEvent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('Discarding malformed job event on jobs.events');
    });

    it('should log a failed notification and keep listening', async () => {
      useCase.fromRedisEvent.mockRejectedValueOnce(new Error('SMTP down'));

      onMessage(JOBS_EVENTS_CHANNEL, JSON.stringify(doneEvent));
      await flushPromises();

      expect(logger.error).toHaveBeenCalledWith('Failed to process job event notification', expect.any(Error), {
        jobId: JOB_ID,
        eventType: JOB_EVENT_TYPES.done,
        errorMessage: 'SMTP down'
      });

      onMessage(JOBS_EVENTS_CHANNEL, JSON.stringify(doneEvent));
      await flushPromises();

      expect(useCase.fromRedisEvent).toHaveBeenCalledTimes(2);
    });

    it('should drop messages that arrive during shutdown', async () => {
      await subscriber.stop();

      onMessage(JOBS_EVENTS_CHANNEL, JSON.stringify(doneEvent));
      await flushPromises();

      // notified_at continua nulo: a varredura do próximo processo envia o e-mail.
      expect(useCase.fromRedisEvent).not.toHaveBeenCalled();
    });
  });
});
