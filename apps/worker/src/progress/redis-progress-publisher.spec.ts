import { parseJobEvent } from '@4frames/shared/jobs';

import { RedisJobEventPublisher } from './redis-progress-publisher';
import { createFakeLogger, JOB_ID, USER_ID } from '../__tests__/fakes';

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('RedisJobEventPublisher', () => {
  let redis: { publish: jest.Mock; set: jest.Mock; del: jest.Mock };
  let logger: ReturnType<typeof createFakeLogger>;
  let clock: number;
  let publisher: RedisJobEventPublisher;

  beforeEach(() => {
    redis = { publish: jest.fn().mockResolvedValue(1), set: jest.fn().mockResolvedValue('OK'), del: jest.fn() };
    logger = createFakeLogger();
    clock = 0;
    publisher = new RedisJobEventPublisher({ redis: redis as never, logger, now: () => clock });
  });

  it('should publish throttled progress on job:{jobId} and keep the last percent in progress:{jobId} with TTL', async () => {
    const report = publisher.createProgressReporter({ jobId: JOB_ID, userId: USER_ID });

    report(5);
    report(12.8);
    clock = 1000;
    report(47.3);
    report(48.1);
    await flush();

    expect(redis.set.mock.calls).toEqual([
      [`progress:${JOB_ID}`, '5', 'EX', 3600],
      [`progress:${JOB_ID}`, '47', 'EX', 3600]
    ]);
    expect(redis.publish).toHaveBeenCalledTimes(2);

    const [channel, raw] = redis.publish.mock.calls[1] as [string, string];
    expect(channel).toBe(`job:${JOB_ID}`);
    expect(parseJobEvent(raw)).toEqual({ type: 'job.progress', jobId: JOB_ID, userId: USER_ID, percent: 47 });
  });

  it('should publish job.done on the job channel and on jobs.events, with progress 100', async () => {
    await publisher.publishDone({ jobId: JOB_ID, userId: USER_ID, zipKey: `zips/7/${JOB_ID}.zip`, frameCount: 45 });

    expect(redis.set).toHaveBeenCalledWith(`progress:${JOB_ID}`, '100', 'EX', 3600);
    expect(redis.publish.mock.calls.map(([channel]) => channel)).toEqual([`job:${JOB_ID}`, 'jobs.events']);
    expect(parseJobEvent(redis.publish.mock.calls[1][1])).toEqual({
      type: 'job.done',
      jobId: JOB_ID,
      userId: USER_ID,
      zipKey: `zips/7/${JOB_ID}.zip`,
      frameCount: 45
    });
  });

  it('should publish job.failed on both channels and drop the partial progress', async () => {
    await publisher.publishFailed({
      jobId: JOB_ID,
      userId: USER_ID,
      reason: 'O arquivo enviado não é um vídeo válido'
    });

    expect(redis.del).toHaveBeenCalledWith(`progress:${JOB_ID}`);
    expect(redis.publish.mock.calls.map(([channel]) => channel)).toEqual([`job:${JOB_ID}`, 'jobs.events']);
    expect(parseJobEvent(redis.publish.mock.calls[0][1])).toEqual({
      type: 'job.failed',
      jobId: JOB_ID,
      userId: USER_ID,
      reason: 'O arquivo enviado não é um vídeo válido'
    });
  });

  it('should only log when Redis is unavailable (best effort)', async () => {
    redis.publish.mockRejectedValue(new Error('Connection is closed.'));

    await expect(
      publisher.publishDone({ jobId: JOB_ID, userId: USER_ID, zipKey: `zips/7/${JOB_ID}.zip`, frameCount: 1 })
    ).resolves.toBeUndefined();

    publisher.createProgressReporter({ jobId: JOB_ID, userId: USER_ID })(10);
    await flush();

    expect(logger.warn).toHaveBeenCalledWith('Failed to publish job event to Redis', {
      eventType: 'job.done',
      jobId: JOB_ID,
      error: 'Connection is closed.'
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to publish job event to Redis',
      expect.objectContaining({ eventType: 'job.progress' })
    );
  });

  it('should not throw for an event that does not match the contract', async () => {
    await expect(
      publisher.publishFailed({ jobId: 'not-a-uuid', userId: USER_ID, reason: 'x' })
    ).resolves.toBeUndefined();
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
