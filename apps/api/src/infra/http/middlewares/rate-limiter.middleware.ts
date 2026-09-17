import rateLimit, { type Options } from 'express-rate-limit';

import { type ErrorResponse } from './error-handler.middleware';

const defaultMessage: ErrorResponse = {
  message: 'Muitas requisições da mesma fonte, tente novamente mais tarde.',
  error: 'TOO_MANY_REQUESTS'
};

const defaultOptions: Partial<Options> = {
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: defaultMessage
};

export function getRateLimiterMiddleware(rateLimitOptions?: Partial<Options>) {
  return rateLimit({
    ...defaultOptions,
    ...rateLimitOptions
  });
}
