import { createRedisClient } from './index';
import { EnvValidationError } from '../env';

describe('createRedisClient', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should create a lazy client that does not connect on creation', () => {
    const client = createRedisClient('redis://redis-host:6390');

    expect(client.status).toBe('wait');
    expect(client.options.host).toBe('redis-host');
    expect(client.options.port).toBe(6390);
    expect(client.options.lazyConnect).toBe(true);

    client.disconnect();
  });

  it('should read REDIS_URL from the environment when no url is given', () => {
    process.env.REDIS_URL = 'redis://from-env:6379';
    const client = createRedisClient();

    expect(client.options.host).toBe('from-env');

    client.disconnect();
  });

  it('should fail fast when REDIS_URL is missing or invalid', () => {
    delete process.env.REDIS_URL;

    expect(() => createRedisClient()).toThrow(EnvValidationError);
  });
});
