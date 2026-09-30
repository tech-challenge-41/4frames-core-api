import { EventEmitter } from 'events';

import { serializeJobEvent } from '@4frames/shared/jobs';

import { type ILogger } from '@/domain/ports/service/logger.interface';

const mockCreateRedisClient = jest.fn();

jest.mock('@4frames/shared/redis', () => ({
  createRedisClient: () => mockCreateRedisClient()
}));

// Import depois do mock: o módulo lê createRedisClient no topo do arquivo.
// eslint-disable-next-line import/first
import { RedisJobEventSubscriberService } from '../redis-job-event-subscriber.service';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
const OTHER_JOB_ID = '00000000-0000-4000-8000-000000000000';
const USER_ID = 1;

class FakeRedisClient extends EventEmitter {
  public get = jest.fn();
  public subscribe = jest.fn().mockResolvedValue(undefined);
  public quit = jest.fn().mockResolvedValue('OK');
}

function createFakeLogger(): jest.Mocked<ILogger> {
  const logger: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  logger.child = jest.fn().mockReturnValue(logger);
  return logger;
}

describe('RedisJobEventSubscriberService', () => {
  let fakeClient: FakeRedisClient;
  let logger: jest.Mocked<ILogger>;
  let service: RedisJobEventSubscriberService;

  beforeEach(() => {
    fakeClient = new FakeRedisClient();
    mockCreateRedisClient.mockReturnValue(fakeClient);
    logger = createFakeLogger();
    service = new RedisJobEventSubscriberService({ logger });
  });

  it('should subscribe to job:{jobId} using a dedicated client', async () => {
    fakeClient.get.mockResolvedValue(null);

    await service.subscribe(JOB_ID, USER_ID, jest.fn());

    expect(fakeClient.subscribe).toHaveBeenCalledWith(`job:${JOB_ID}`);
  });

  it('should read the current progress before subscribing and emit it as a synthetic progress event', async () => {
    fakeClient.get.mockResolvedValue('42');
    const onEvent = jest.fn();

    await service.subscribe(JOB_ID, USER_ID, onEvent);

    expect(fakeClient.get).toHaveBeenCalledWith(`progress:${JOB_ID}`);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'job.progress',
      jobId: JOB_ID,
      userId: USER_ID,
      percent: 42
    });
  });

  it('should not emit a synthetic event when there is no known progress', async () => {
    fakeClient.get.mockResolvedValue(null);
    const onEvent = jest.fn();

    await service.subscribe(JOB_ID, USER_ID, onEvent);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('should forward parsed messages from the subscribed channel', async () => {
    fakeClient.get.mockResolvedValue(null);
    const onEvent = jest.fn();

    await service.subscribe(JOB_ID, USER_ID, onEvent);

    const event = { type: 'job.progress' as const, jobId: JOB_ID, userId: USER_ID, percent: 80 };
    fakeClient.emit('message', `job:${JOB_ID}`, serializeJobEvent(event));

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('should ignore messages from other channels', async () => {
    fakeClient.get.mockResolvedValue(null);
    const onEvent = jest.fn();

    await service.subscribe(JOB_ID, USER_ID, onEvent);

    fakeClient.emit(
      'message',
      `job:${OTHER_JOB_ID}`,
      serializeJobEvent({ type: 'job.progress' as const, jobId: OTHER_JOB_ID, userId: USER_ID, percent: 10 })
    );

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('should discard malformed messages without throwing', async () => {
    fakeClient.get.mockResolvedValue(null);
    const onEvent = jest.fn();

    await service.subscribe(JOB_ID, USER_ID, onEvent);

    expect(() => fakeClient.emit('message', `job:${JOB_ID}`, 'not-json')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should close the dedicated client on unsubscribe', async () => {
    fakeClient.get.mockResolvedValue(null);

    const subscription = await service.subscribe(JOB_ID, USER_ID, jest.fn());
    await subscription.unsubscribe();

    expect(fakeClient.quit).toHaveBeenCalledTimes(1);
  });

  it('should be idempotent when unsubscribe is called more than once', async () => {
    fakeClient.get.mockResolvedValue(null);

    const subscription = await service.subscribe(JOB_ID, USER_ID, jest.fn());
    await subscription.unsubscribe();
    await subscription.unsubscribe();

    expect(fakeClient.quit).toHaveBeenCalledTimes(1);
  });
});
