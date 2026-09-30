import '@4frames/shared/env/load';

import { HealthServer } from '@4frames/shared/health';
import { createLogger } from '@4frames/shared/logger';
import { shutdownOtel } from '@4frames/shared/monitoring/load';
import { prisma } from '@4frames/shared/prisma';
import { registerGracefulShutdown } from '@4frames/shared/process';

import { NotifyVideoJobTerminalUseCase } from '@/application/notify-video-job-terminal.usecase';
import { readNotifierEnv } from '@/config/notifier-env';
import { EmailSenderService } from '@/infra/email/email-sender.service';
import { VideoJobNotificationService } from '@/infra/notifications/email/services/video-job-notification.service';
import { UnnotifiedJobsRecovery } from '@/recovery/unnotified-jobs-recovery';
import { PrismaVideoJobNotifierRepository } from '@/repo/video-job-notifier.repository';
import { RedisJobEventsSubscriber } from '@/subscriber/redis-job-events.subscriber';

const SERVICE_NAME = 'notifier';

async function bootstrap(): Promise<void> {
  const env = readNotifierEnv();
  const logger = createLogger({ base: { service: SERVICE_NAME } });

  const repository = new PrismaVideoJobNotifierRepository();
  const emailSender = new EmailSenderService({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    from: env.MAIL_FROM,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS
  });
  const notificationService = new VideoJobNotificationService(emailSender);
  const notifyUseCase = new NotifyVideoJobTerminalUseCase({
    repository,
    notificationService,
    webAppBaseUrl: env.WEB_APP_URL,
    logger
  });

  const subscriber = new RedisJobEventsSubscriber({
    redisUrl: env.REDIS_URL,
    useCase: notifyUseCase,
    logger
  });

  const recovery = new UnnotifiedJobsRecovery({
    repository,
    useCase: notifyUseCase,
    logger,
    intervalMs: env.NOTIFIER_RECOVERY_INTERVAL_SECONDS * 1000,
    batchSize: env.NOTIFIER_RECOVERY_BATCH_SIZE
  });

  const healthServer = new HealthServer({
    port: env.NOTIFIER_HEALTH_PORT,
    isAlive: () => subscriber.isAlive(),
    logger
  });

  registerGracefulShutdown({
    logger,
    onShutdown: async () => {
      recovery.stop();
      await subscriber.stop();
      await healthServer.stop();
      await prisma.$disconnect();
      await shutdownOtel();
    }
  });

  recovery.start();
  await subscriber.start();
  // Depois da assinatura, como no worker: enquanto o notifier não conseguiu assinar, ele não tem o
  // que reportar, e a probe falhando por conexão recusada é a resposta certa.
  await healthServer.start();

  const smtpInboxHint =
    env.SMTP_HOST === 'mailpit' || env.SMTP_HOST === 'localhost'
      ? 'http://localhost:8025 (Mailpit)'
      : `caixa do provedor configurado em SMTP_HOST (${env.SMTP_HOST}:${env.SMTP_PORT})`;

  logger.info('Notifier started', {
    nodeEnv: env.NODE_ENV,
    webAppUrl: env.WEB_APP_URL,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpInboxHint,
    healthPort: env.NOTIFIER_HEALTH_PORT,
    recoveryIntervalSeconds: env.NOTIFIER_RECOVERY_INTERVAL_SECONDS
  });
}

bootstrap().catch((error: unknown) => {
  console.error(`[${SERVICE_NAME}] Failed to start`, error);
  process.exit(1);
});
