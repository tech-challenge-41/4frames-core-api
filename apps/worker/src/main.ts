import '@4frames/shared/env/load';

import { parseEnv, runtimeEnvSchema } from '@4frames/shared/env';
import { createLogger } from '@4frames/shared/logger';
import { registerGracefulShutdown } from '@4frames/shared/process';

const SERVICE_NAME = 'worker';
const KEEP_ALIVE_INTERVAL_MS = 60_000;

function bootstrap(): void {
  const env = parseEnv(runtimeEnvSchema);
  const logger = createLogger({ base: { service: SERVICE_NAME } });

  // Scaffold: o consumer SQS com ffmpeg entra no Card 2 e substitui este keep-alive.
  const keepAlive = setInterval(() => undefined, KEEP_ALIVE_INTERVAL_MS);

  registerGracefulShutdown({
    logger,
    onShutdown: () => {
      clearInterval(keepAlive);
    }
  });

  logger.info('Worker started (scaffold, no queue consumer yet)', { nodeEnv: env.NODE_ENV });
}

try {
  bootstrap();
} catch (error) {
  console.error(`[${SERVICE_NAME}] Failed to start`, error);
  process.exit(1);
}
