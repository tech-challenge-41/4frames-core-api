import { type IncomingMessage, type ServerResponse } from 'node:http';

import { type RequestHandler } from 'express';
import pinoHttp from 'pino-http';

import { rootPinoLogger } from './application-logger';

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

const REDACTED = '[REDACTED]';

// Headers com credencial: toda rota autenticada manda o JWT em Authorization.
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

/**
 * O EventSource do navegador não envia header, então o SSE recebe o JWT em `?token=` (ver
 * sseAuthMiddleware). O valor sai da URL antes de ir para o log.
 */
export function redactUrlToken(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/gi, `$1${REDACTED}`);
}

/** Forma do `req` que o pino-http entrega ao serializer (já passado pelo serializer padrão do pino). */
interface LoggedRequest {
  [key: string]: unknown;
  url?: string;
  query?: unknown;
  headers?: Record<string, unknown>;
}

/** Serializer do `req` no log de acesso: nenhuma credencial, de header ou de query string, chega ao log. */
export function redactRequestForLog(req: LoggedRequest): LoggedRequest {
  const headers =
    req.headers &&
    Object.fromEntries(
      Object.entries(req.headers).map(([name, value]) => [
        name,
        SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value
      ])
    );
  const query =
    req.query !== null && typeof req.query === 'object' && 'token' in req.query
      ? { ...req.query, token: REDACTED }
      : req.query;

  return { ...req, url: req.url === undefined ? undefined : redactUrlToken(req.url), query, headers };
}

export function formatHttpAccessLogMessage(req: IncomingMessage, res: ServerResponse): string {
  const status = res.statusCode;

  return `${status} - ${req.method} ${redactUrlToken(req.url ?? '')}`;
}

const PROBE_PATHS = new Set(['/health-check', '/ready']);

export function createHttpRequestLoggerMiddleware(): RequestHandler {
  return pinoHttp({
    logger: rootPinoLogger,
    serializers: { req: redactRequestForLog },
    customLogLevel: resolveHttpRequestLogLevel,
    customSuccessMessage: (req, res) => formatHttpAccessLogMessage(req, res),
    customErrorMessage: (req, res) => formatHttpAccessLogMessage(req, res),
    autoLogging: {
      // Probes do kubelet: uma linha a cada poucos segundos por réplica, sem informação útil.
      ignore: (req: IncomingMessage) => PROBE_PATHS.has(req.url ?? '')
    }
  });
}
