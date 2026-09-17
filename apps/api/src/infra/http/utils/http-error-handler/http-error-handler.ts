import { ApplicationError } from '@/application/error/application-error';
import { DomainError } from '@/domain/error/domain-error';
import { appLogger } from '@/infra/logging/application-logger';

import { typesToStatusCode } from './types-to-status-code';

interface ErrorHandlerResponse {
  status: number;
  message: string;
  data?: Record<string, unknown>;
}

export function httpErrorHandler(error: DomainError | Error): ErrorHandlerResponse {
  if (error instanceof DomainError) {
    const status = typesToStatusCode[error.type] || 500;
    const message = error.message || 'Internal server error';
    const data = error.data || {};

    return {
      status,
      message,
      data
    };
  }

  if (error instanceof ApplicationError) {
    return {
      status: error.status || 500,
      message: error.message || 'Internal server error',
      data: error.data || {}
    };
  }

  appLogger.child({ component: 'httpErrorHandler' }).warn('Unhandled error in httpErrorHandler', {
    name: error.name,
    message: error.message
  });

  return {
    status: 500,
    message: 'Internal server error',
    data: {}
  };
}
