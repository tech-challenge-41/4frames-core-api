import { type Logger } from './logger';
import { PinoLoggerAdapter } from './pino-logger.adapter';
import { createRootPinoLogger, type RootPinoLoggerOptions } from './pino-root.factory';

export type { LogBindings, Logger } from './logger';
export { PinoLoggerAdapter } from './pino-logger.adapter';
export { createRootPinoLogger, defaultLogLevel, isTestRuntime, type RootPinoLoggerOptions } from './pino-root.factory';

export function createLogger(options: RootPinoLoggerOptions = {}): Logger {
  return new PinoLoggerAdapter(createRootPinoLogger(options));
}
