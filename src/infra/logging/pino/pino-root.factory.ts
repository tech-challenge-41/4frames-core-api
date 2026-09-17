import pino from 'pino';

import { getRequestLogContext } from '../request-log-context';

const isProduction = process.env.NODE_ENV === 'production';

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
}

const isTest = isTestRuntime();

function defaultLogLevelFromNodeEnv(): string {
  if (isTest) {
    return 'error';
  }

  if (isProduction) {
    return 'info';
  }

  return 'debug';
}

function createRootPino(): pino.Logger {
  const level = process.env.LOG_LEVEL ?? defaultLogLevelFromNodeEnv();

  const baseOptions: pino.LoggerOptions = {
    level,
    mixin() {
      const ctx = getRequestLogContext();

      if (ctx === undefined) {
        return {};
      }

      return { requestId: ctx.requestId, correlationId: ctx.correlationId };
    }
  };

  if (isTest) {
    return pino(baseOptions, process.stdout);
  }

  if (isProduction) {
    return pino(baseOptions);
  }

  return pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname'
      }
    }
  });
}

export const rootPinoLogger = createRootPino();
