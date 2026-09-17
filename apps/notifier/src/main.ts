import '@4frames/shared/env/load';

import { parseEnv, runtimeEnvSchema } from '@4frames/shared/env';
import { createLogger } from '@4frames/shared/logger';
import { registerGracefulShutdown } from '@4frames/shared/process';

const SERVICE_NAME = 'notifier';
const KEEP_ALIVE_INTERVAL_MS = 60_000;

function bootstrap(): void {
  const env = parseEnv(runtimeEnvSchema);
  const logger = createLogger({ base: { service: SERVICE_NAME } });

  // Scaffold: a assinatura de jobs.events e o envio de e-mail entram no Card 4 e substituem este keep-alive.
  const keepAlive = setInterval(() => undefined, KEEP_ALIVE_INTERVAL_MS);

  registerGracefulShutdown({
    logger,
    onShutdown: () => {
      clearInterval(keepAlive);
    }
  });

  logger.info('Notifier started (scaffold, no event subscriber yet)', { nodeEnv: env.NODE_ENV });
}

try {
  bootstrap();
} catch (error) {
  console.error(`[${SERVICE_NAME}] Failed to start`, error);
  process.exit(1);
}
