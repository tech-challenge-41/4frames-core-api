import '@4frames/shared/env/load';

import { HTTPInitialize } from '@/infra/http/http-initialize';
import { appLogger } from '@/infra/logging/application-logger';

async function bootstrap() {
  await HTTPInitialize();
}

bootstrap().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  appLogger.error('Failed to initialize server', err);
  process.exit(1);
});
