import pino from 'pino';

import { type LogBindings } from './logger';

export interface RootPinoLoggerOptions {
  /** Campos adicionados a cada linha de log (ex.: requestId/correlationId da requisição atual). */
  mixin?: () => LogBindings;
  /** Sobrescreve LOG_LEVEL e o nível padrão por ambiente. */
  level?: string;
  /** Campos fixos em todas as linhas (ex.: { service: 'worker' }). */
  base?: LogBindings;
}

export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.JEST_WORKER_ID !== undefined;
}

export function defaultLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  if (isTestRuntime(env)) {
    return 'error';
  }

  if (env.NODE_ENV === 'production') {
    return 'info';
  }

  return 'debug';
}

/**
 * Cria o pino raiz. O ambiente é lido na chamada (não no import), para que o .env já tenha sido carregado.
 * - test: stdout síncrono, nível error
 * - production: JSON, nível info
 * - desenvolvimento: pino-pretty, nível debug
 */
export function createRootPinoLogger({ mixin, level, base }: RootPinoLoggerOptions = {}): pino.Logger {
  const env = process.env;

  const baseOptions: pino.LoggerOptions = {
    level: level ?? env.LOG_LEVEL ?? defaultLogLevel(env),
    ...(base ? { base: { pid: process.pid, ...base } } : {}),
    ...(mixin ? { mixin } : {})
  };

  if (isTestRuntime(env)) {
    return pino(baseOptions, process.stdout);
  }

  if (env.NODE_ENV === 'production') {
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
