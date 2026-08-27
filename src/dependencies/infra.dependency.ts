import { LOGGER_KEY } from '@/domain/ports/service/logger.interface';
import { appLogger } from '@/infra/logging/application-logger';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';
import { JwtSecretKeyFactory } from '@/infra/services/jwt-secret-key.factory';
import JwtSecretKeyService from '@/infra/services/jwt-secret-key.service';
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
}
