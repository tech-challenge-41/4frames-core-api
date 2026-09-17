import { type ILogger } from '@/domain/ports/service/logger.interface';

import { PinoLoggerAdapter } from './pino-logger.adapter';
import { rootPinoLogger } from './pino-root.factory';

export const appLogger: ILogger = new PinoLoggerAdapter(rootPinoLogger);
