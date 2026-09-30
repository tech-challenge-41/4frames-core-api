import { EventEmitter } from 'node:events';

import { createRedisClient } from '@4frames/shared/redis';

import { type ILogger } from '@/domain/ports/service/logger.interface';

import { createRedisCommandClient, REDIS_COMMAND_TIMEOUT_MS } from '../redis-command-client';

jest.mock('@4frames/shared/redis', () => ({
  createRedisClient: jest.fn()
}));

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

describe('createRedisCommandClient', () => {
  let fakeClient: EventEmitter;

  beforeEach(() => {
    fakeClient = new EventEmitter();
    (createRedisClient as jest.Mock).mockReturnValue(fakeClient);
  });

  it('should fail fast: one retry per command and a command timeout', () => {
    const client = createRedisCommandClient(createLogger());

    expect(client).toBe(fakeClient);
    expect(createRedisClient).toHaveBeenCalledWith(undefined, {
      maxRetriesPerRequest: 1,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS
    });
  });

  it('should log connection errors at debug level instead of leaving them unhandled', () => {
    const logger = createLogger();
    createRedisCommandClient(logger);

    fakeClient.emit('error', new Error('ECONNREFUSED'));

    expect(logger.debug).toHaveBeenCalledWith('Redis command connection error', { error: 'ECONNREFUSED' });
  });
});
