import { randomUUID } from 'node:crypto';

import { type NextFunction, type Request, type Response } from 'express';

import { requestLogContextStorage, type RequestLogContext } from '@/infra/logging/request-log-context';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

function firstHeader(req: Request, name: string): string | undefined {
  const value = req.get(name);

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requestCorrelationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = firstHeader(req, REQUEST_ID_HEADER);
  const incomingCorrelationId = firstHeader(req, CORRELATION_ID_HEADER);

  const requestId = incomingRequestId ?? randomUUID();
  const correlationId = incomingCorrelationId ?? requestId;

  res.setHeader(REQUEST_ID_HEADER, requestId);
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  const authorization = firstHeader(req, 'authorization');
  const store: RequestLogContext = {
    requestId,
    correlationId,
    ...(authorization ? { authorizationHeader: authorization } : {})
  };

  requestLogContextStorage.run(store, () => {
    next();
  });
}
