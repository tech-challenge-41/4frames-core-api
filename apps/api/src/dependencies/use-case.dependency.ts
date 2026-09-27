import { CheckReadinessUseCase } from '@/application/use-case/system/check-readiness/check-readiness.usecase';
import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { CancelVideoJobUseCase } from '@/application/use-case/video/cancel-video-job/cancel-video-job.usecase';
import { CompleteVideoJobUseCase } from '@/application/use-case/video/complete-video-job/complete-video-job.usecase';
import { CreateVideoJobUseCase } from '@/application/use-case/video/create-video-job/create-video-job.usecase';
import { GetVideoJobDownloadUrlUseCase } from '@/application/use-case/video/get-video-job-download-url/get-video-job-download-url.usecase';
import { GetVideoJobStatusUseCase } from '@/application/use-case/video/get-video-job-status/get-video-job-status.usecase';
import { ListVideoJobsUseCase } from '@/application/use-case/video/list-video-jobs/list-video-jobs.usecase';
import { LOGGER_KEY } from '@/domain/ports/service/logger.interface';
import { readUploadUrlTtlSeconds } from '@/infra/config/upload.config';
import { PostgresHealthService } from '@/infra/services/postgres-health.service';
import { RedisHealthService } from '@/infra/services/redis-health.service';
import { RedisJobProgressReaderService } from '@/infra/services/redis-job-progress-reader.service';
import { S3PresignedUrlService } from '@/infra/services/s3-presigned-url.service';
import { UserAuthenticatorService } from '@/infra/services/user-authenticator.service';
import { VideoJobService } from '@/infra/services/video-job.service';

import { type Container } from './container';

export async function useCaseDependency(c: Container) {
  c.register(
    AuthenticateUserUseCase.name,
    new AuthenticateUserUseCase({
      userAuthenticatorService: c.resolve(UserAuthenticatorService.name)
    })
  );
  c.register(
    CreateVideoJobUseCase.name,
    new CreateVideoJobUseCase({
      videoJobService: c.resolve(VideoJobService.name),
      videoStorageService: c.resolve(S3PresignedUrlService.name),
      uploadUrlExpiresInSeconds: readUploadUrlTtlSeconds()
    })
  );
  c.register(
    GetVideoJobStatusUseCase.name,
    new GetVideoJobStatusUseCase({
      videoJobService: c.resolve(VideoJobService.name),
      jobProgressReader: c.resolve(RedisJobProgressReaderService.name)
    })
  );
  c.register(
    CompleteVideoJobUseCase.name,
    new CompleteVideoJobUseCase({
      videoJobService: c.resolve(VideoJobService.name),
      videoStorageService: c.resolve(S3PresignedUrlService.name)
    })
  );
  c.register(
    GetVideoJobDownloadUrlUseCase.name,
    new GetVideoJobDownloadUrlUseCase({
      videoJobService: c.resolve(VideoJobService.name),
      videoStorageService: c.resolve(S3PresignedUrlService.name)
    })
  );
  c.register(
    ListVideoJobsUseCase.name,
    new ListVideoJobsUseCase({
      videoJobService: c.resolve(VideoJobService.name),
      jobProgressReader: c.resolve(RedisJobProgressReaderService.name)
    })
  );
  c.register(
    CancelVideoJobUseCase.name,
    new CancelVideoJobUseCase({
      videoJobService: c.resolve(VideoJobService.name)
    })
  );
  c.register(
    CheckReadinessUseCase.name,
    new CheckReadinessUseCase({
      indicators: [c.resolve(PostgresHealthService.name), c.resolve(RedisHealthService.name)],
      logger: c.resolve(LOGGER_KEY)
    })
  );
}
