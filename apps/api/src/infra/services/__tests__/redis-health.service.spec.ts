import { EventEmitter } from 'node:events';

import { type Redis } from '@4frames/shared/redis';

import { type ILogger } from '@/domain/ports/service/logger.interface';

import { RedisHealthService } from '../redis-health.service';

class FakeRedis extends EventEmitter {
  public ping = jest.fn();
  public disconnect = jest.fn();
}

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

describe('RedisHealthService', () => {
  let client: FakeRedis;
  let logger: jest.Mocked<ILogger>;
  let service: RedisHealthService;

  beforeEach(() => {
    client = new FakeRedis();
    logger = createLogger();
    service = new RedisHealthService({ logger, client: client as unknown as Redis });
  });

  it('should be named redis', () => {
    expect(service.name).toBe('redis');
  });

  it('should resolve when PING answers PONG', async () => {
    client.ping.mockResolvedValue('PONG');

    await expect(service.check()).resolves.toBeUndefined();
  });

  it('should reject an unexpected PING reply', async () => {
    client.ping.mockResolvedValue('LOADING');

    await expect(service.check()).rejects.toThrow('Unexpected PING reply: LOADING');
  });

  it('should reject when Redis is unreachable', async () => {
    client.ping.mockRejectedValue(new Error('Reached the max retries per request limit'));

    await expect(service.check()).rejects.toThrow('max retries');
  });

  it('should log connection errors at debug level instead of leaving them unhandled', () => {
    client.emit('error', new Error('ECONNREFUSED'));

    expect(logger.debug).toHaveBeenCalledWith('Redis health connection error', { error: 'ECONNREFUSED' });
  });

  it('should disconnect without waiting for Redis on close', () => {
    service.close();

    expect(client.disconnect).toHaveBeenCalled();
  });
});
