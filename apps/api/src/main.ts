import '@4frames/shared/env/load';

import { shutdownOtel } from '@4frames/shared/monitoring/load';
import { registerGracefulShutdown } from '@4frames/shared/process';

import { readShutdownTimeouts } from '@/infra/config/shutdown.config';
import { HTTPInitialize } from '@/infra/http/http-initialize';
import { appLogger } from '@/infra/logging/application-logger';

async function bootstrap() {
  const { shutdownTimeoutMs, drainTimeoutMs } = readShutdownTimeouts();
  const { shutdown } = await HTTPInitialize({ drainTimeoutMs });

  // No container a API é o PID 1: sem este handler, o kernel ignora o SIGTERM e o pod só sai no SIGKILL, no
  // fim do terminationGracePeriodSeconds, cortando as conexões abertas.
  registerGracefulShutdown({
    logger: appLogger,
    timeoutMs: shutdownTimeoutMs,
    onShutdown: async () => {
      await shutdown();
      await shutdownOtel();
    }
  });
}

bootstrap().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  appLogger.error('Failed to initialize server', err);
  process.exit(1);
});
