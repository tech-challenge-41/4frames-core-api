import { type Redis } from '@4frames/shared/redis';

import { RedisHealthService } from '../redis-health.service';

describe('RedisHealthService', () => {
  let client: { ping: jest.Mock };
  let service: RedisHealthService;

  beforeEach(() => {
    client = { ping: jest.fn() };
    service = new RedisHealthService({ client: client as unknown as Redis });
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
});
