import '@4frames/shared/env/load';

import { shutdownOtel } from '@4frames/shared/monitoring/load';
import { prisma } from '@4frames/shared/prisma';
import { registerGracefulShutdown } from '@4frames/shared/process';

import { ExpireAbandonedUploadsUseCase } from '@/application/use-case/video/expire-abandoned-uploads/expire-abandoned-uploads.usecase';
import { readUploadUrlTtlSeconds } from '@/infra/config/upload.config';
import { appLogger } from '@/infra/logging/application-logger';
import { VideoJobService } from '@/infra/services/video-job.service';

import { ExpirationRunner } from './expiration-runner';

/**
 * Rotina de expiração de uploads abandonados, na mesma imagem da API e fora das réplicas dela:
 *   node dist/cron/main.js --once   uma passada e sai (CronJob expire-uploads no cluster)
 *   node dist/cron/main.js          uma passada por minuto até o SIGTERM (desenvolvimento)
 * Só precisa do Postgres: não passa pelo Container da API, que também montaria S3, JWT e Redis.
 */
async function bootstrap() {
  // Use case e runner acrescentam o próprio `component`: um child aqui duplicaria a chave no JSON do log.
  const logger = appLogger;
  const runner = new ExpirationRunner({
    useCase: new ExpireAbandonedUploadsUseCase({
      videoJobService: new VideoJobService(),
      logger,
      uploadUrlExpiresInSeconds: readUploadUrlTtlSeconds()
    }),
    logger
  });

  if (process.argv.includes('--once')) {
    try {
      await runner.runOnce();
    } finally {
      await prisma.$disconnect();
      await shutdownOtel();
    }

    return;
  }

  registerGracefulShutdown({
    logger,
    onShutdown: async () => {
      await runner.stop();
      await prisma.$disconnect();
      await shutdownOtel();
    }
  });
  runner.start();
}

bootstrap().catch((error: unknown) => {
  appLogger.error('Expiration failed', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
