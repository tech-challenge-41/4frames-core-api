import { LOGGER_KEY } from '@/domain/ports/service/logger.interface';
import { SseStreamRegistry } from '@/infra/http/shutdown/sse-stream-registry';
import { appLogger } from '@/infra/logging/application-logger';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';
import { JwtSecretKeyFactory } from '@/infra/services/jwt-secret-key.factory';
import JwtSecretKeyService from '@/infra/services/jwt-secret-key.service';
import { PostgresHealthService } from '@/infra/services/postgres-health.service';
import { createRedisCommandClient, REDIS_COMMAND_CLIENT_KEY } from '@/infra/services/redis-command-client';
import { RedisHealthService } from '@/infra/services/redis-health.service';
import { RedisJobEventSubscriberService } from '@/infra/services/redis-job-event-subscriber.service';
import { RedisJobProgressReaderService } from '@/infra/services/redis-job-progress-reader.service';
import { S3PresignedUrlFactory } from '@/infra/services/s3-presigned-url.factory';
import { S3PresignedUrlService } from '@/infra/services/s3-presigned-url.service';
import { UserAuthenticatorService } from '@/infra/services/user-authenticator.service';
import { VideoJobService } from '@/infra/services/video-job.service';

import { type Container } from './container';

export async function infraDependency(c: Container) {
  c.register(LOGGER_KEY, appLogger);
  c.register(JwtSecretKeyService.name, JwtSecretKeyFactory.create());
  c.register(UserAuthenticatorService.name, new UserAuthenticatorService({ jwt: c.resolve(JwtSecretKeyService.name) }));
  c.register(JwtAuthenticatorService.name, new JwtAuthenticatorService());
  c.register(S3PresignedUrlService.name, S3PresignedUrlFactory.create());
  c.register(VideoJobService.name, new VideoJobService());
  c.register(RedisJobEventSubscriberService.name, new RedisJobEventSubscriberService({ logger: appLogger }));
  c.register(PostgresHealthService.name, new PostgresHealthService());

  // Uma conexão Redis de comandos para a API toda (PING do /ready e MGET do progresso), fechada no encerramento.
  const redisCommandClient = createRedisCommandClient(appLogger);
  c.register(REDIS_COMMAND_CLIENT_KEY, redisCommandClient);
  c.register(RedisHealthService.name, new RedisHealthService({ client: redisCommandClient }));
  c.register(
    RedisJobProgressReaderService.name,
    new RedisJobProgressReaderService({ client: redisCommandClient, logger: appLogger })
  );

  c.register(SseStreamRegistry.name, new SseStreamRegistry());
}
