import { createRootPinoLogger, PinoLoggerAdapter } from '@4frames/shared/logger';

import { type ILogger } from '@/domain/ports/service/logger.interface';

import { getRequestLogContext } from '../request-log-context';

function requestContextMixin(): Record<string, unknown> {
  const ctx = getRequestLogContext();

  if (ctx === undefined) {
    return {};
  }

  return { requestId: ctx.requestId, correlationId: ctx.correlationId };
}

export const rootPinoLogger = createRootPinoLogger({ mixin: requestContextMixin });

export const appLogger: ILogger = new PinoLoggerAdapter(rootPinoLogger);
