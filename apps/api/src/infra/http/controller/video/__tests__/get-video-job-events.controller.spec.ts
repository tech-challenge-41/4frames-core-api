import { EventEmitter } from 'events';

import { type JobEvent } from '@4frames/shared/jobs';
import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import {
  type IJobEventSubscriber,
  type JobEventSubscription
} from '@/domain/ports/service/job-event-subscriber.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';
import { SseStreamRegistry } from '@/infra/http/shutdown/sse-stream-registry';

import { GetVideoJobEventsController, SHUTDOWN_RECONNECT_DELAY_MS } from '../get-video-job-events.controller';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

class FakeResponse extends EventEmitter {
  public writeHead = jest.fn();
  public flushHeaders = jest.fn();
  public write = jest.fn();
  public end = jest.fn(() => {
    this.emit('close');
  });
}

function buildRequest(): Partial<Request> & EventEmitter {
  const req = new EventEmitter() as any;
  req.authenticated = { userId: 1 };
  req.params = { jobId: JOB_ID };
  return req;
}

describe('GetVideoJobEventsController', () => {
  let mockStatusUseCase: jest.Mocked<IUseCase<any, any>>;
  let mockSubscriber: jest.Mocked<IJobEventSubscriber>;
  let mockSubscription: jest.Mocked<JobEventSubscription>;
  let controller: GetVideoJobEventsController;
  let sseStreams: SseStreamRegistry;
  let onEventCallback: (event: JobEvent) => void;

  beforeEach(() => {
    jest.useFakeTimers();

    mockStatusUseCase = { execute: jest.fn().mockResolvedValue({ jobId: JOB_ID, status: 'PROCESSING' }) };
    mockSubscription = { unsubscribe: jest.fn().mockResolvedValue(undefined) };
    mockSubscriber = {
      subscribe: jest.fn().mockImplementation((_jobId, _userId, onEvent) => {
        onEventCallback = onEvent;
        return Promise.resolve(mockSubscription);
      })
    };

    sseStreams = new SseStreamRegistry();
    controller = new GetVideoJobEventsController(mockStatusUseCase, mockSubscriber, sseStreams);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should authorize via the status use case before writing anything', async () => {
    mockStatusUseCase.execute.mockRejectedValue(new Error('Video job not found'));
    const req = buildRequest();
    const res = new FakeResponse();

    await expect(controller.handle(req as Request, res as unknown as Response)).rejects.toThrow('Video job not found');
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(mockSubscriber.subscribe).not.toHaveBeenCalled();
  });

  it('should throw InvalidRequestParamError for a malformed jobId without touching the subscriber', async () => {
    const req = buildRequest();
    req.params = { jobId: 'not-a-uuid' };
    const res = new FakeResponse();

    await expect(controller.handle(req as Request, res as unknown as Response)).rejects.toThrow(
      InvalidRequestParamError
    );
    expect(mockStatusUseCase.execute).not.toHaveBeenCalled();
    expect(mockSubscriber.subscribe).not.toHaveBeenCalled();
  });

  it('should write SSE headers and subscribe once authorized', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(mockSubscriber.subscribe).toHaveBeenCalledWith(JOB_ID, 1, expect.any(Function));

    req.emit('close');
    await handled;
  });

  it('should write each event as an SSE data line', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    const event: JobEvent = { type: 'job.progress', jobId: JOB_ID, userId: 1, percent: 42 };
    onEventCallback(event);

    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    req.emit('close');
    await handled;
  });

  it('should end the stream, unsubscribe, and resolve when a job.done event arrives', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    onEventCallback({ type: 'job.done', jobId: JOB_ID, userId: 1, zipKey: 'zips/1/x.zip', frameCount: 10 });

    await handled;

    expect(res.end).toHaveBeenCalled();
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
  });

  it('should end the stream and unsubscribe when a job.failed event arrives', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    onEventCallback({ type: 'job.failed', jobId: JOB_ID, userId: 1, reason: 'boom' });

    await handled;

    expect(res.end).toHaveBeenCalled();
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
  });

  it('should unsubscribe when the client closes the connection', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    req.emit('close');
    await handled;

    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
  });

  it('should write periodic heartbeat comments while the stream is open', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(15_000);

    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');

    req.emit('close');
    await handled;
  });

  it('should stop the heartbeat after the connection closes', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    req.emit('close');
    await handled;

    res.write.mockClear();
    jest.advanceTimersByTime(30_000);

    expect(res.write).not.toHaveBeenCalled();
  });

  it('should write an error event and end the stream when the subscription fails', async () => {
    mockSubscriber.subscribe.mockRejectedValue(new Error('redis unavailable'));
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await handled;

    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: 'error', message: 'redis unavailable' })}\n\n`
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('should register the open stream and leave the registry when the client closes it', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    expect(sseStreams.size).toBe(1);

    req.emit('close');
    await handled;

    expect(sseStreams.size).toBe(0);
  });

  it('on shutdown, should end the stream with a short retry and release the Redis subscription', async () => {
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    await expect(sseStreams.closeAll()).resolves.toBe(1);
    await handled;

    expect(res.write).toHaveBeenLastCalledWith(`retry: ${SHUTDOWN_RECONNECT_DELAY_MS}\n\n`);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(mockSubscription.unsubscribe).toHaveBeenCalledTimes(1);

    res.write.mockClear();
    jest.advanceTimersByTime(30_000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('should end a stream opened while the replica is shutting down right away', async () => {
    await sseStreams.closeAll();
    const req = buildRequest();
    const res = new FakeResponse();

    await controller.handle(req as Request, res as unknown as Response);

    // A assinatura é liberada logo depois de o stream terminar, na resolução da promise do subscribe.
    for (let tick = 0; tick < 5; tick++) {
      await Promise.resolve();
    }

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.write).toHaveBeenCalledWith(`retry: ${SHUTDOWN_RECONNECT_DELAY_MS}\n\n`);
    expect(res.end).toHaveBeenCalled();
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
  });

  it('should write a generic error message when the subscription rejects with a non-Error value', async () => {
    mockSubscriber.subscribe.mockRejectedValue('boom');
    const req = buildRequest();
    const res = new FakeResponse();

    const handled = controller.handle(req as Request, res as unknown as Response);
    await handled;

    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: 'error', message: 'subscription failed' })}\n\n`
    );
    expect(res.end).toHaveBeenCalled();
  });
});
