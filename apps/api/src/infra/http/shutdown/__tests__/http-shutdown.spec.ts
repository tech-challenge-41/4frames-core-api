import { EventEmitter } from 'node:events';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { registerGracefulShutdown } from '@4frames/shared/process';
import express, { type Request, type Response } from 'express';

import { type JobEventSubscription } from '@/domain/ports/service/job-event-subscriber.service.interface';
import { type ILogger } from '@/domain/ports/service/logger.interface';
import {
  GetVideoJobEventsController,
  SHUTDOWN_RECONNECT_DELAY_MS
} from '@/infra/http/controller/video/get-video-job-events.controller';

import { HttpShutdown } from '../http-shutdown';
import { SseStreamRegistry } from '../sse-stream-registry';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
const SLOW_RESPONSE_MS = 300;

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met in time');
    }

    await delay(10);
  }
}

describe('HttpShutdown', () => {
  let server: Server;
  let port: number;
  let sseStreams: SseStreamRegistry;
  let shutdown: HttpShutdown;
  let closeResources: jest.Mock;
  let logger: jest.Mocked<ILogger>;
  let subscription: jest.Mocked<JobEventSubscription>;

  function get(path: string, agent?: http.Agent): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path, agent }, response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => (body += chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
        })
        .on('error', reject);
    });
  }

  /** Abre o stream SSE e resolve quando os headers chegaram; `result` resolve quando o servidor encerrar. */
  function openStream(path: string): Promise<{ result: Promise<HttpResult> }> {
    return new Promise((resolveOpen, reject) => {
      http
        .get({ host: '127.0.0.1', port, path }, response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => (body += chunk));
          const result = new Promise<HttpResult>(resolve =>
            response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }))
          );
          resolveOpen({ result });
        })
        .on('error', reject);
    });
  }

  beforeEach(async () => {
    logger = createLogger();
    sseStreams = new SseStreamRegistry();
    closeResources = jest.fn().mockResolvedValue(undefined);
    shutdown = new HttpShutdown({ sseStreams, logger, drainTimeoutMs: 5_000, closeResources });

    subscription = { unsubscribe: jest.fn().mockResolvedValue(undefined) };
    const eventsController = new GetVideoJobEventsController(
      { execute: jest.fn().mockResolvedValue({ jobId: JOB_ID, status: 'PROCESSING' }) },
      { subscribe: jest.fn().mockResolvedValue(subscription) },
      sseStreams
    );

    const app = express();
    app.use(shutdown.connectionCloseMiddleware);
    app.get('/fast', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.get('/slow', (_req, res) => {
      setTimeout(() => res.status(200).json({ ok: true }), SLOW_RESPONSE_MS);
    });
    app.get('/videos/:jobId/events', (req: Request, res) => {
      req.authenticated = { userId: 1 };
      void eventsController.handle(req, res);
    });

    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    // Maior que qualquer espera do teste: uma conexão keep-alive só fecha rápido se o encerramento a fechar.
    server.keepAliveTimeout = 30_000;
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('on SIGTERM, should end the SSE streams, finish in-flight requests and stop accepting connections', async () => {
    const signals = new EventEmitter();
    const exit = jest.fn();
    registerGracefulShutdown({
      logger,
      onShutdown: () => shutdown.run(server),
      exit,
      source: signals as unknown as NodeJS.Process
    });

    const stream = await openStream(`/videos/${JOB_ID}/events`);
    const inFlight = get('/slow');
    await delay(50);

    signals.emit('SIGTERM', 'SIGTERM');

    const streamed = await stream.result;
    expect(streamed.status).toBe(200);
    expect(streamed.body).toContain(`retry: ${SHUTDOWN_RECONNECT_DELAY_MS}\n\n`);

    await expect(inFlight).resolves.toMatchObject({ status: 200, body: '{"ok":true}' });

    await waitFor(() => exit.mock.calls.length > 0);
    expect(exit).toHaveBeenCalledWith(0);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(closeResources).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('SSE streams closed', { streams: 1 });
    // Agent sem keep-alive: o globalAgent reaproveitaria um socket antigo, e o erro seria outro.
    await expect(get('/fast', new http.Agent({ keepAlive: false }))).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('should close keep-alive connections that go idle after their last response', async () => {
    const agent = new http.Agent({ keepAlive: true });

    try {
      const inFlight = get('/slow', agent);
      await delay(50);

      const started = Date.now();
      await shutdown.run(server);

      await expect(inFlight).resolves.toMatchObject({ status: 200 });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      agent.destroy();
    }
  });

  it('should keep the connection alive before the shutdown', async () => {
    const answered = await get('/fast', new http.Agent({ keepAlive: true }));

    expect(answered.headers.connection).toBe('keep-alive');
  });
});

describe('HttpShutdown with a stuck connection', () => {
  class FakeServer {
    public readonly close = jest.fn((callback: (error?: Error) => void) => {
      this.onClosed = callback;
    });

    public readonly closeIdleConnections = jest.fn();
    public readonly closeAllConnections = jest.fn(() => this.onClosed?.());

    private onClosed?: (error?: Error) => void;

    public fail(error: Error): void {
      this.onClosed?.(error);
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should close the remaining connections when the drain timeout is reached', async () => {
    const logger = createLogger();
    const closeResources = jest.fn().mockResolvedValue(undefined);
    const shutdown = new HttpShutdown({
      sseStreams: new SseStreamRegistry(),
      logger,
      drainTimeoutMs: 1_000,
      closeResources
    });
    const server = new FakeServer();

    const running = shutdown.run(server as unknown as Server);
    await jest.advanceTimersByTimeAsync(999);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(server.closeIdleConnections).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await running;

    expect(server.closeAllConnections).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Drain timeout reached, closing remaining connections', {
      drainTimeoutMs: 1_000
    });
    expect(closeResources).toHaveBeenCalled();
  });

  it('should answer with Connection: close once the shutdown started', () => {
    const shutdown = new HttpShutdown({
      sseStreams: new SseStreamRegistry(),
      logger: createLogger(),
      drainTimeoutMs: 1_000,
      closeResources: jest.fn().mockResolvedValue(undefined)
    });
    const before = { setHeader: jest.fn() };
    const during = { setHeader: jest.fn() };
    const next = jest.fn();

    shutdown.connectionCloseMiddleware({} as Request, before as unknown as Response, next);
    void shutdown.run(new FakeServer() as unknown as Server);
    shutdown.connectionCloseMiddleware({} as Request, during as unknown as Response, next);

    expect(before.setHeader).not.toHaveBeenCalled();
    expect(during.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('should reject, without closing the resources, when the server fails to close', async () => {
    const closeResources = jest.fn().mockResolvedValue(undefined);
    const shutdown = new HttpShutdown({
      sseStreams: new SseStreamRegistry(),
      logger: createLogger(),
      drainTimeoutMs: 1_000,
      closeResources
    });
    const server = new FakeServer();

    const running = shutdown.run(server as unknown as Server);
    await Promise.resolve();
    server.fail(new Error('Server is not running.'));

    await expect(running).rejects.toThrow('Server is not running.');
    expect(closeResources).not.toHaveBeenCalled();
  });
});
