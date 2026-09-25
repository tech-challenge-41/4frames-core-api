import type * as NodeStream from 'node:stream';

import express from 'express';
import type * as Pino from 'pino';
import request from 'supertest';

import {
  createHttpRequestLoggerMiddleware,
  formatHttpAccessLogMessage,
  redactRequestForLog,
  redactUrlToken
} from '../http-request-logger.middleware';

const mockLogLines: string[] = [];

// Logger real do pino, escrevendo numa lista: o teste lê o que de fato iria para o log.
jest.mock('../application-logger', () => {
  const { Writable } = jest.requireActual<typeof NodeStream>('node:stream');
  const { pino } = jest.requireActual<typeof Pino>('pino');
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      mockLogLines.push(chunk.toString());
      callback();
    }
  });

  return { rootPinoLogger: pino({ level: 'info' }, destination) };
});

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.assinatura';

describe('http request logger', () => {
  beforeEach(() => {
    mockLogLines.length = 0;
  });

  describe('redactUrlToken', () => {
    it('should hide the token query parameter and keep the others', () => {
      expect(redactUrlToken(`/videos/1/events?token=${JWT}&x=1`)).toBe('/videos/1/events?token=[REDACTED]&x=1');
      expect(redactUrlToken(`/videos/1/events?x=1&token=${JWT}`)).toBe('/videos/1/events?x=1&token=[REDACTED]');
    });

    it('should leave URLs without a token untouched', () => {
      expect(redactUrlToken('/videos?offset=0&limit=20')).toBe('/videos?offset=0&limit=20');
    });
  });

  describe('redactRequestForLog', () => {
    it('should hide credential headers and the query token, keeping everything else', () => {
      const logged = redactRequestForLog({
        id: 7,
        method: 'GET',
        url: `/videos/1/events?token=${JWT}`,
        query: { token: JWT, other: 'value' },
        headers: { 'authorization': `Bearer ${JWT}`, 'cookie': 'session=abc', 'user-agent': 'curl' }
      });

      expect(logged).toEqual({
        id: 7,
        method: 'GET',
        url: '/videos/1/events?token=[REDACTED]',
        query: { token: '[REDACTED]', other: 'value' },
        headers: { 'authorization': '[REDACTED]', 'cookie': '[REDACTED]', 'user-agent': 'curl' }
      });
    });

    it('should cope with a request that has no headers or query', () => {
      expect(redactRequestForLog({ method: 'GET', url: '/health-check' })).toEqual({
        method: 'GET',
        url: '/health-check',
        query: undefined,
        headers: undefined
      });
    });
  });

  it('should build the access log message without the token', () => {
    const message = formatHttpAccessLogMessage(
      { method: 'GET', url: `/videos/1/events?token=${JWT}` } as never,
      { statusCode: 200 } as never
    );

    expect(message).toBe('200 - GET /videos/1/events?token=[REDACTED]');
  });

  it('should never write a JWT to the access log, from the header or from the SSE query string', async () => {
    const app = express();
    app.use(createHttpRequestLoggerMiddleware());
    app.use((_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/videos').set('Authorization', `Bearer ${JWT}`);
    await request(app).get(`/videos/1/events?token=${JWT}`);
    await new Promise(resolve => setImmediate(resolve));

    const output = mockLogLines.join('');
    expect(mockLogLines).toHaveLength(2);
    expect(output).not.toContain(JWT);
    expect(output).toContain('"authorization":"[REDACTED]"');
    expect(output).toContain('/videos/1/events?token=[REDACTED]');
  });
});
