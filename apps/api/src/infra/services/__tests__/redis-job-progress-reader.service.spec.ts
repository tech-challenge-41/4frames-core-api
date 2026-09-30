import { type Redis } from '@4frames/shared/redis';

import { type ILogger } from '@/domain/ports/service/logger.interface';

import { RedisJobProgressReaderService } from '../redis-job-progress-reader.service';

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

describe('RedisJobProgressReaderService', () => {
  let client: { mget: jest.Mock };
  let logger: jest.Mocked<ILogger>;
  let reader: RedisJobProgressReaderService;

  beforeEach(() => {
    client = { mget: jest.fn() };
    logger = createLogger();
    reader = new RedisJobProgressReaderService({ client: client as unknown as Redis, logger });
  });

  it('should read every job in a single MGET on progress:{jobId}', async () => {
    client.mget.mockResolvedValue(['42', null, '37.5']);

    const progress = await reader.getMany(['job-a', 'job-b', 'job-c']);

    expect(client.mget).toHaveBeenCalledTimes(1);
    expect(client.mget).toHaveBeenCalledWith('progress:job-a', 'progress:job-b', 'progress:job-c');
    expect(progress).toEqual(
      new Map([
        ['job-a', 42],
        ['job-c', 37.5]
      ])
    );
  });

  it('should not call Redis for an empty list', async () => {
    await expect(reader.getMany([])).resolves.toEqual(new Map());
    expect(client.mget).not.toHaveBeenCalled();
  });

  it('should skip values that are not numbers and clamp the rest to 0–100', async () => {
    client.mget.mockResolvedValue(['abc', '150', '-3']);

    const progress = await reader.getMany(['job-a', 'job-b', 'job-c']);

    expect(progress).toEqual(
      new Map([
        ['job-b', 100],
        ['job-c', 0]
      ])
    );
  });

  it('should return no progress, instead of failing, when Redis does not answer', async () => {
    client.mget.mockRejectedValue(new Error('Command timed out'));

    await expect(reader.getMany(['job-a'])).resolves.toEqual(new Map());
    expect(logger.warn).toHaveBeenCalledWith('Failed to read job progress', { jobs: 1, error: 'Command timed out' });
  });

  it('should log a non-Error rejection as text', async () => {
    client.mget.mockRejectedValue('NOAUTH');

    await expect(reader.getMany(['job-a'])).resolves.toEqual(new Map());
    expect(logger.warn).toHaveBeenCalledWith('Failed to read job progress', { jobs: 1, error: 'NOAUTH' });
  });
});
