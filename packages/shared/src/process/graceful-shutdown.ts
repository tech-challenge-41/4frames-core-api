import { type Logger } from '../logger/logger';

type SignalSource = Pick<NodeJS.Process, 'on' | 'removeListener'>;

export interface GracefulShutdownOptions {
  logger: Logger;
  /** Libera recursos (terminar o job atual, fechar filas e conexões). */
  onShutdown: (signal: NodeJS.Signals) => Promise<void> | void;
  signals?: NodeJS.Signals[];
  /** Tempo máximo para `onShutdown`. No Compose deve ficar abaixo do `stop_grace_period`. */
  timeoutMs?: number;
  exit?: (code: number) => void;
  source?: SignalSource;
}

export const DEFAULT_SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Registra o encerramento gracioso: no primeiro sinal chama `onShutdown` e sai com 0 (ou 1 em erro ou timeout).
 * Um segundo sinal durante o encerramento força a saída com 1. Devolve uma função que remove os listeners.
 */
export function registerGracefulShutdown({
  logger,
  onShutdown,
  signals = DEFAULT_SHUTDOWN_SIGNALS,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  exit = code => process.exit(code),
  source = process
}: GracefulShutdownOptions): () => void {
  let shuttingDown = false;

  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn('Second shutdown signal received, forcing exit', { signal });
      exit(1);
      return;
    }

    shuttingDown = true;
    logger.info('Shutdown started', { signal, timeoutMs });

    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Shutdown timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref();
    });

    let cleanup: Promise<void>;

    try {
      cleanup = Promise.resolve(onShutdown(signal));
    } catch (error) {
      cleanup = Promise.reject(error);
    }

    Promise.race([cleanup, timeout])
      .then(() => {
        logger.info('Shutdown completed', { signal });
        exit(0);
      })
      .catch((error: unknown) => {
        logger.error('Shutdown failed', error instanceof Error ? error : new Error(String(error)), { signal });
        exit(1);
      })
      .finally(() => clearTimeout(timer));
  };

  signals.forEach(signal => source.on(signal, handler));

  return () => signals.forEach(signal => source.removeListener(signal, handler));
}
