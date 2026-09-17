import { type IncomingMessage, type ServerResponse } from 'node:http';

import { type RequestHandler } from 'express';
import pinoHttp from 'pino-http';

import { rootPinoLogger } from './pino-root.factory';

export function resolveHttpRequestLogLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error
): 'info' | 'warn' | 'error' {
  if (err !== undefined || res.statusCode >= 500) {
    return 'error';
  }

  if (res.statusCode >= 400) {
    return 'warn';
  }

  return 'info';
}

export function formatHttpAccessLogMessage(req: IncomingMessage, res: ServerResponse): string {
  const status = res.statusCode;

  return `${status} - ${req.method} ${req.url}`;
}

export function createHttpRequestLoggerMiddleware(): RequestHandler {
  return pinoHttp({
    logger: rootPinoLogger,
    customLogLevel: resolveHttpRequestLogLevel,
    customSuccessMessage: (req, res) => formatHttpAccessLogMessage(req, res),
    customErrorMessage: (req, res) => formatHttpAccessLogMessage(req, res),
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url === '/health-check'
    }
  });
}
