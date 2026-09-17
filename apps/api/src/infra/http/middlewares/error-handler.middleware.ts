import { type NextFunction, type Request, type Response } from 'express';

import { AuthError } from '@/application/error/auth-error';
import { appLogger } from '@/infra/logging/application-logger';

export interface ErrorResponse {
  message: string;
  error?: string;
  data?: Record<string, unknown>;
}

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): Response | void {
  const log = appLogger.child({ component: 'ErrorHandler' });

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof SyntaxError && 'body' in err) {
    log.warn('JSON parsing error', { detail: err.message });
    const response: ErrorResponse = {
      message: 'JSON inválido no corpo da requisição',
      error: 'BAD_REQUEST'
    };

    return res.status(400).json(response);
  }

  if (err instanceof AuthError) {
    log.warn(err.message, { status: 401, error: 'UNAUTHORIZED' });

    const response: ErrorResponse = {
      message: err.message,
      error: 'UNAUTHORIZED'
    };

    return res.status(401).json(response);
  }

  log.error('Unhandled error', err, { name: err.name });

  const response: ErrorResponse = {
    message: 'Erro interno do servidor',
    error: 'INTERNAL_SERVER_ERROR'
  };

  return res.status(500).json(response);
}
