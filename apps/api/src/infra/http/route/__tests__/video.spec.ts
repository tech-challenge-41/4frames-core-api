import { type IncomingMessage } from 'node:http';

import { JOB_EVENT_TYPES, type JobEvent } from '@4frames/shared/jobs';
import { type Express } from 'express';
import { sign, type SignOptions } from 'jsonwebtoken';
import request from 'supertest';

import { Container } from '@/dependencies/container';
import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import {
  type IJobEventSubscriber,
  type JobEventSubscription
} from '@/domain/ports/service/job-event-subscriber.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';
import { CancelVideoJobController } from '@/infra/http/controller/video/cancel-video-job.controller';
import { CompleteVideoJobController } from '@/infra/http/controller/video/complete-video-job.controller';
import { GetVideoJobDownloadUrlController } from '@/infra/http/controller/video/get-video-job-download-url.controller';
import { GetVideoJobEventsController } from '@/infra/http/controller/video/get-video-job-events.controller';
import { GetVideoJobStatusController } from '@/infra/http/controller/video/get-video-job-status.controller';
import { ListVideoJobsController } from '@/infra/http/controller/video/list-video-jobs.controller';
import { VideoController } from '@/infra/http/controller/video/video.controller';
import { openapi } from '@/infra/http/docs/openapi';
import { createHttpApp } from '@/infra/http/http-app';
import { SseStreamRegistry } from '@/infra/http/shutdown/sse-stream-registry';
import { rootPinoLogger } from '@/infra/logging/pino/application-logger';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';

jest.mock('@/dependencies/container', () => ({ Container: { getInstance: jest.fn() } }));

const JWT_SECRET = 'segredo-dos-testes-de-rota';
const USER_ID = 42;
const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
const VALID_BODY = { fileName: 'aula.mp4', fileSize: 10_485_760, contentType: 'video/mp4' };

type Method = 'get' | 'post';

/** [método, caminho no OpenAPI, sufixo depois de /videos/:jobId] das rotas com :jobId. */
const JOB_ROUTES: [Method, string, string][] = [
  ['get', '/videos/{jobId}', ''],
  ['post', '/videos/{jobId}/complete', '/complete'],
  ['post', '/videos/{jobId}/cancel', '/cancel'],
  ['get', '/videos/{jobId}/download', '/download'],
  ['get', '/videos/{jobId}/events', '/events']
];

/** [método, caminho no OpenAPI, URL] de todas as rotas de /videos. */
const VIDEO_ROUTES: [Method, string, string][] = [
  ['post', '/videos', '/videos'],
  ['get', '/videos', '/videos'],
  ...JOB_ROUTES.map(([method, path, suffix]): [Method, string, string] => [method, path, `/videos/${JOB_ID}${suffix}`])
];

function token(options: SignOptions = { expiresIn: '1h' }, secret = JWT_SECRET): string {
  return sign({ userId: USER_ID }, secret, { algorithm: 'HS256', ...options });
}

function bearer(value = token()): Record<string, string> {
  return { Authorization: `Bearer ${value}` };
}

/** A resposta devolvida pela rota está entre as documentadas para a operação no OpenAPI. */
function expectDocumented(method: Method, path: string, status: number): void {
  const operation = openapi.paths[path]?.[method] as { responses?: Record<string, unknown> } | undefined;

  expect(Object.keys(operation?.responses ?? {})).toContain(String(status));
}

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met in time');
    }

    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * Lê a resposta como stream. `chunks` recebe cada pedaço assim que ele chega, antes de a resposta terminar;
 * `response` resolve no fim do stream, com o corpo inteiro em `body`.
 */
function readStream(test: request.Test): { chunks: string[]; response: Promise<request.Response> } {
  const chunks: string[] = [];
  const response = test
    .buffer(true)
    .parse((res, callback) => {
      const stream = res as unknown as IncomingMessage;
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => chunks.push(chunk));
      stream.on('end', () => callback(null, chunks.join('')));
    })
    .then(result => result);

  return { chunks, response };
}

/** Os eventos `data: <json>` de um corpo SSE, na ordem. */
function sseEvents(body: string): unknown[] {
  return body
    .split('\n\n')
    .filter(message => message.startsWith('data: '))
    .map(message => JSON.parse(message.slice('data: '.length)));
}

describe('Rotas de /videos pelo HTTP, com os middlewares reais', () => {
  const originalSecret = process.env.JWT_SECRET_KEY;
  const originalLogLevel = rootPinoLogger.level;

  let app: Express;
  let createUseCase: jest.Mocked<IUseCase<any, any>>;
  let listUseCase: jest.Mocked<IUseCase<any, any>>;
  let statusUseCase: jest.Mocked<IUseCase<any, any>>;
  let completeUseCase: jest.Mocked<IUseCase<any, any>>;
  let cancelUseCase: jest.Mocked<IUseCase<any, any>>;
  let downloadUseCase: jest.Mocked<IUseCase<any, any>>;
  let subscriber: jest.Mocked<IJobEventSubscriber>;
  let subscription: jest.Mocked<JobEventSubscription>;
  let sseStreams: SseStreamRegistry;

  function expectNoUseCaseCalled(): void {
    for (const useCase of [
      createUseCase,
      listUseCase,
      statusUseCase,
      completeUseCase,
      cancelUseCase,
      downloadUseCase
    ]) {
      expect(useCase.execute).not.toHaveBeenCalled();
    }

    expect(subscriber.subscribe).not.toHaveBeenCalled();
  }

  beforeAll(() => {
    process.env.JWT_SECRET_KEY = JWT_SECRET;
    // O authMiddleware registra cada 401 como erro; aqui os 401 são esperados.
    rootPinoLogger.level = 'silent';
    app = createHttpApp({ connectionCloseMiddleware: (_request, _response, next) => next() });
  });

  afterAll(() => {
    process.env.JWT_SECRET_KEY = originalSecret;
    rootPinoLogger.level = originalLogLevel;
  });

  beforeEach(() => {
    const newUseCase = (): jest.Mocked<IUseCase<any, any>> => ({ execute: jest.fn() });

    createUseCase = newUseCase();
    listUseCase = newUseCase();
    statusUseCase = newUseCase();
    completeUseCase = newUseCase();
    cancelUseCase = newUseCase();
    downloadUseCase = newUseCase();
    subscription = { unsubscribe: jest.fn().mockResolvedValue(undefined) };
    subscriber = { subscribe: jest.fn() };
    sseStreams = new SseStreamRegistry();

    // O JwtAuthenticatorService e os controllers são os reais; só os use cases e o subscriber do Redis são mocks.
    const registered = new Map<string, unknown>([
      [JwtAuthenticatorService.name, new JwtAuthenticatorService()],
      [VideoController.name, new VideoController(createUseCase)],
      [ListVideoJobsController.name, new ListVideoJobsController(listUseCase)],
      [GetVideoJobStatusController.name, new GetVideoJobStatusController(statusUseCase)],
      [CompleteVideoJobController.name, new CompleteVideoJobController(completeUseCase)],
      [CancelVideoJobController.name, new CancelVideoJobController(cancelUseCase)],
      [GetVideoJobDownloadUrlController.name, new GetVideoJobDownloadUrlController(downloadUseCase)],
      [GetVideoJobEventsController.name, new GetVideoJobEventsController(statusUseCase, subscriber, sseStreams)]
    ]);

    (Container.getInstance as jest.Mock).mockReturnValue({
      resolve: (name: string) => {
        if (!registered.has(name)) {
          throw new Error(`${name} não registrado no Container do teste`);
        }

        return registered.get(name);
      }
    });
  });

  /** A requisição da rota, com um body válido no POST: o 401 não pode depender de o body estar errado. */
  function call(method: Method, url: string): request.Test {
    const test = request(app)[method](url);

    return method === 'post' ? test.send(VALID_BODY) : test;
  }

  describe('autenticação', () => {
    it.each(VIDEO_ROUTES)('should answer 401 on %s %s without a token', async (method, path, url) => {
      const response = await call(method, url);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authorization header is missing' });
      expectDocumented(method, path, 401);
      expectNoUseCaseCalled();
    });

    it.each(VIDEO_ROUTES)(
      'should answer 401 on %s %s with a token signed by another secret',
      async (method, _path, url) => {
        const response = await call(method, url).set(bearer(token({ expiresIn: '1h' }, 'outro-segredo')));

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'invalid signature' });
        expectNoUseCaseCalled();
      }
    );

    it('should answer 401 with an expired token', async () => {
      const expired = sign({ userId: USER_ID, exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET, {
        algorithm: 'HS256'
      });

      const response = await request(app).get('/videos').set(bearer(expired));

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'jwt expired' });
      expectNoUseCaseCalled();
    });

    it('should answer 401 when the Authorization header has no token', async () => {
      const response = await request(app).get('/videos').set('Authorization', 'Bearer');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Token is missing' });
    });

    it('should not accept ?token= outside the SSE route', async () => {
      const response = await request(app).get(`/videos?token=${token()}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authorization header is missing' });
      expectNoUseCaseCalled();
    });
  });

  describe('POST /videos', () => {
    it('should create the job for the user in the token and answer 201 with the upload URL', async () => {
      const created = {
        jobId: JOB_ID,
        uploadUrl: 'http://localhost:4566/4frames/videos/42/x.mp4?X-Amz=1',
        expiresIn: 300
      };
      createUseCase.execute.mockResolvedValue(created);

      const response = await request(app).post('/videos').set(bearer()).send(VALID_BODY);

      expect(response.status).toBe(201);
      expect(response.body).toEqual(created);
      expect(createUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, ...VALID_BODY });
      expectDocumented('post', '/videos', 201);
    });

    it.each([
      ['without fileName', { fileSize: 1024, contentType: 'video/mp4' }, 'fileName'],
      ['with an empty fileName', { ...VALID_BODY, fileName: '' }, 'fileName'],
      ['with fileSize zero', { ...VALID_BODY, fileSize: 0 }, 'fileSize'],
      ['with fileSize above 500 MB', { ...VALID_BODY, fileSize: 500 * 1024 * 1024 + 1 }, 'fileSize'],
      ['with fileSize as a string', { ...VALID_BODY, fileSize: '1024' }, 'fileSize'],
      ['with a content type outside the list', { ...VALID_BODY, contentType: 'video/x-msvideo' }, 'contentType']
    ])('should answer 400 %s', async (_description, body, field) => {
      const response = await request(app).post('/videos').set(bearer()).send(body);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.data.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
      expectDocumented('post', '/videos', 400);
      expectNoUseCaseCalled();
    });

    it('should answer 400 to a malformed JSON body', async () => {
      const response = await request(app)
        .post('/videos')
        .set(bearer())
        .set('Content-Type', 'application/json')
        .send('{"fileName": "aula.mp4",');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('JSON inválido no corpo da requisição');
      expectNoUseCaseCalled();
    });
  });

  describe('GET /videos', () => {
    const page = { items: [], total: 0, limit: 20, offset: 0 };

    it('should list with the default page when there is no query', async () => {
      listUseCase.execute.mockResolvedValue(page);

      const response = await request(app).get('/videos').set(bearer());

      expect(response.status).toBe(200);
      expect(response.body).toEqual(page);
      expect(listUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, limit: 20, offset: 0 });
      expectDocumented('get', '/videos', 200);
    });

    it('should pass limit and offset as numbers', async () => {
      listUseCase.execute.mockResolvedValue({ ...page, limit: 100, offset: 40 });

      const response = await request(app).get('/videos?limit=100&offset=40').set(bearer());

      expect(response.status).toBe(200);
      expect(listUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, limit: 100, offset: 40 });
    });

    it.each(['limit=0', 'limit=101', 'limit=2.5', 'limit=abc', 'offset=-1', 'offset=1.5', 'offset=abc'])(
      'should answer 400 to %s',
      async query => {
        const response = await request(app).get(`/videos?${query}`).set(bearer());

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid pagination parameters');
        expectDocumented('get', '/videos', 400);
        expectNoUseCaseCalled();
      }
    );
  });

  describe(':jobId fora do formato UUID', () => {
    it.each(JOB_ROUTES)('should answer 400 on %s %s', async (method, path, suffix) => {
      const response = await request(app)[method](`/videos/123${suffix}`).set(bearer());

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('jobId must be a valid UUID');
      expectDocumented(method, path, 400);
      expectNoUseCaseCalled();
    });
  });

  describe('GET /videos/:jobId', () => {
    it('should answer 200 with the status of the job', async () => {
      const status = { jobId: JOB_ID, status: 'PROCESSING', fileName: 'aula.mp4', progress: 37 };
      statusUseCase.execute.mockResolvedValue(status);

      const response = await request(app).get(`/videos/${JOB_ID}`).set(bearer());

      expect(response.status).toBe(200);
      expect(response.body).toEqual(status);
      expect(statusUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, jobId: JOB_ID });
    });

    it('should answer 404 when the job does not exist or belongs to another user', async () => {
      statusUseCase.execute.mockRejectedValue(
        new DomainError({ message: 'Video job not found', type: DomainErrorTypes.NOT_FOUND })
      );

      const response = await request(app).get(`/videos/${JOB_ID}`).set(bearer());

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Video job not found');
      expectDocumented('get', '/videos/{jobId}', 404);
    });
  });

  describe('POST /videos/:jobId/complete e /cancel', () => {
    it('should confirm the upload and answer 200', async () => {
      const queued = { jobId: JOB_ID, status: 'QUEUED', fileName: 'aula.mp4' };
      completeUseCase.execute.mockResolvedValue(queued);

      const response = await request(app).post(`/videos/${JOB_ID}/complete`).set(bearer());

      expect(response.status).toBe(200);
      expect(response.body).toEqual(queued);
      expect(completeUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, jobId: JOB_ID });
    });

    it('should answer 422 when the job is not awaiting the upload', async () => {
      completeUseCase.execute.mockRejectedValue(
        new DomainError({
          message: 'Video job is not awaiting upload confirmation',
          type: DomainErrorTypes.INVALID_STATE
        })
      );

      const response = await request(app).post(`/videos/${JOB_ID}/complete`).set(bearer());

      expect(response.status).toBe(422);
      expectDocumented('post', '/videos/{jobId}/complete', 422);
    });

    it('should cancel the job and answer 200', async () => {
      const canceled = { jobId: JOB_ID, status: 'EXPIRED' };
      cancelUseCase.execute.mockResolvedValue(canceled);

      const response = await request(app).post(`/videos/${JOB_ID}/cancel`).set(bearer());

      expect(response.status).toBe(200);
      expect(response.body).toEqual(canceled);
      expect(cancelUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, jobId: JOB_ID });
    });
  });

  describe('GET /videos/:jobId/download', () => {
    it('should answer 200 with the presigned URL of the zip', async () => {
      const download = { downloadUrl: 'http://localhost:4566/4frames/zips/42/x.zip?X-Amz=1', expiresIn: 300 };
      downloadUseCase.execute.mockResolvedValue(download);

      const response = await request(app).get(`/videos/${JOB_ID}/download`).set(bearer());

      expect(response.status).toBe(200);
      expect(response.body).toEqual(download);
      expect(downloadUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, jobId: JOB_ID });
      expectDocumented('get', '/videos/{jobId}/download', 200);
    });

    it('should answer 404 when the job does not exist or belongs to another user', async () => {
      downloadUseCase.execute.mockRejectedValue(
        new DomainError({ message: 'Video job not found', type: DomainErrorTypes.NOT_FOUND })
      );

      const response = await request(app).get(`/videos/${JOB_ID}/download`).set(bearer());

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Video job not found');
      expectDocumented('get', '/videos/{jobId}/download', 404);
    });

    it('should answer 422 when the job is not done yet', async () => {
      downloadUseCase.execute.mockRejectedValue(
        new DomainError({ message: 'Video job is not done yet', type: DomainErrorTypes.INVALID_STATE })
      );

      const response = await request(app).get(`/videos/${JOB_ID}/download`).set(bearer());

      expect(response.status).toBe(422);
      expectDocumented('get', '/videos/{jobId}/download', 422);
    });
  });

  describe('GET /videos/:jobId/events (SSE)', () => {
    const progress: JobEvent = { type: JOB_EVENT_TYPES.progress, jobId: JOB_ID, userId: USER_ID, percent: 40 };
    const done: JobEvent = {
      type: JOB_EVENT_TYPES.done,
      jobId: JOB_ID,
      userId: USER_ID,
      zipKey: `zips/${USER_ID}/${JOB_ID}.zip`,
      frameCount: 30
    };

    let emit: ((event: JobEvent) => void) | undefined;

    beforeEach(() => {
      emit = undefined;
      statusUseCase.execute.mockResolvedValue({ jobId: JOB_ID, status: 'PROCESSING', fileName: 'aula.mp4' });
      subscriber.subscribe.mockImplementation(async (_jobId, _userId, onEvent) => {
        emit = onEvent;
        return subscription;
      });
    });

    it('should stream the events with ?token= as they happen, until job.done', async () => {
      const { chunks, response } = readStream(request(app).get(`/videos/${JOB_ID}/events?token=${token()}`));

      // O subscriber só é chamado depois do writeHead: o stream está aberto.
      await waitFor(() => emit !== undefined);
      expect(sseStreams.size).toBe(1);

      emit!(progress);
      // O progresso chega ao cliente antes do fim do stream.
      await waitFor(() => chunks.join('').includes('"percent":40'));
      expect(chunks.join('')).not.toContain(JOB_EVENT_TYPES.done);

      emit!(done);
      const result = await response;

      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toBe('text/event-stream');
      expect(result.headers['cache-control']).toBe('no-cache');
      expect(result.headers['x-accel-buffering']).toBe('no');
      expect(sseEvents(result.body)).toEqual([progress, done]);
      expect(statusUseCase.execute).toHaveBeenCalledWith({ userId: USER_ID, jobId: JOB_ID });
      expect(subscriber.subscribe).toHaveBeenCalledWith(JOB_ID, USER_ID, expect.any(Function));
      expectDocumented('get', '/videos/{jobId}/events', 200);

      // O fim do stream fecha a conexão Redis da assinatura e tira o stream do registro.
      await waitFor(() => subscription.unsubscribe.mock.calls.length > 0);
      expect(sseStreams.size).toBe(0);
    });

    it('should also accept the Authorization header', async () => {
      subscriber.subscribe.mockImplementation(async (_jobId, _userId, onEvent) => {
        setImmediate(() => onEvent(done));
        return subscription;
      });

      const { response } = readStream(request(app).get(`/videos/${JOB_ID}/events`).set(bearer()));
      const result = await response;

      expect(result.status).toBe(200);
      expect(sseEvents(result.body)).toEqual([done]);
    });

    it('should answer 401 to an invalid ?token=', async () => {
      const invalid = token({ expiresIn: '1h' }, 'outro-segredo');

      const response = await request(app).get(`/videos/${JOB_ID}/events?token=${invalid}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'invalid signature' });
      expectNoUseCaseCalled();
    });

    it('should answer 404 before opening the stream when the job is not the user’s', async () => {
      statusUseCase.execute.mockRejectedValue(
        new DomainError({ message: 'Video job not found', type: DomainErrorTypes.NOT_FOUND })
      );

      const response = await request(app).get(`/videos/${JOB_ID}/events?token=${token()}`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body.message).toBe('Video job not found');
      expect(subscriber.subscribe).not.toHaveBeenCalled();
      expect(sseStreams.size).toBe(0);
      expectDocumented('get', '/videos/{jobId}/events', 404);
    });
  });
});
