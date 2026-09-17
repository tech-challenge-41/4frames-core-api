import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { CompleteVideoJobUseCase } from '@/application/use-case/video/complete-video-job/complete-video-job.usecase';
import { CreateVideoJobUseCase } from '@/application/use-case/video/create-video-job/create-video-job.usecase';
import { GetVideoJobStatusUseCase } from '@/application/use-case/video/get-video-job-status/get-video-job-status.usecase';
import { readUploadUrlTtlSeconds } from '@/infra/config/upload.config';
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
      videoJobService: c.resolve(VideoJobService.name)
    })
  );
  c.register(
    CompleteVideoJobUseCase.name,
    new CompleteVideoJobUseCase({
      videoJobService: c.resolve(VideoJobService.name),
      videoStorageService: c.resolve(S3PresignedUrlService.name)
    })
  );
}
