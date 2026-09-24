import { JOBS_EVENTS_CHANNEL } from '@4frames/shared/jobs';
import { createLogger } from '@4frames/shared/logger';
import { createRedisClient, type Redis } from '@4frames/shared/redis';

import { type NotifyVideoJobTerminalUseCase } from '@/application/notify-video-job-terminal.usecase';

import { RedisJobEventsSubscriber } from './redis-job-events.subscriber';

jest.mock('@4frames/shared/redis', () => ({ createRedisClient: jest.fn() }));

const createRedisClientMock = createRedisClient as jest.MockedFunction<typeof createRedisClient>;

function createFakeRedis() {
  return {
    status: 'ready',
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK')
  };
}

describe('RedisJobEventsSubscriber', () => {
  const useCase = { fromRedisEvent: jest.fn() } as unknown as NotifyVideoJobTerminalUseCase;
  const logger = createLogger({ level: 'silent' });

  let client: ReturnType<typeof createFakeRedis>;
  let subscriber: RedisJobEventsSubscriber;

  beforeEach(() => {
    jest.clearAllMocks();
    client = createFakeRedis();
    createRedisClientMock.mockReturnValue(client as unknown as Redis);
    subscriber = new RedisJobEventsSubscriber({ redisUrl: 'redis://localhost:6379', useCase, logger });
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
});
