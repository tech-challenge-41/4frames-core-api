import { CheckReadinessUseCase } from '@/application/use-case/system/check-readiness/check-readiness.usecase';
import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { CancelVideoJobUseCase } from '@/application/use-case/video/cancel-video-job/cancel-video-job.usecase';
import { CompleteVideoJobUseCase } from '@/application/use-case/video/complete-video-job/complete-video-job.usecase';
import { CreateVideoJobUseCase } from '@/application/use-case/video/create-video-job/create-video-job.usecase';
import { GetVideoJobDownloadUrlUseCase } from '@/application/use-case/video/get-video-job-download-url/get-video-job-download-url.usecase';
import { GetVideoJobStatusUseCase } from '@/application/use-case/video/get-video-job-status/get-video-job-status.usecase';
import { ListVideoJobsUseCase } from '@/application/use-case/video/list-video-jobs/list-video-jobs.usecase';
import { AuthController } from '@/infra/http/controller/auth/auth.controller';
import { ReadinessController } from '@/infra/http/controller/system/readiness.controller';
import { CancelVideoJobController } from '@/infra/http/controller/video/cancel-video-job.controller';
import { CompleteVideoJobController } from '@/infra/http/controller/video/complete-video-job.controller';
import { GetVideoJobDownloadUrlController } from '@/infra/http/controller/video/get-video-job-download-url.controller';
import { GetVideoJobEventsController } from '@/infra/http/controller/video/get-video-job-events.controller';
import { GetVideoJobStatusController } from '@/infra/http/controller/video/get-video-job-status.controller';
import { ListVideoJobsController } from '@/infra/http/controller/video/list-video-jobs.controller';
import { VideoController } from '@/infra/http/controller/video/video.controller';
import { SseStreamRegistry } from '@/infra/http/shutdown/sse-stream-registry';
import { RedisJobEventSubscriberService } from '@/infra/services/redis-job-event-subscriber.service';

import { type Container } from './container';

export async function controllerDependency(c: Container) {
  c.register(AuthController.name, new AuthController(c.resolve(AuthenticateUserUseCase.name)));
  c.register(VideoController.name, new VideoController(c.resolve(CreateVideoJobUseCase.name)));
  c.register(
    GetVideoJobStatusController.name,
    new GetVideoJobStatusController(c.resolve(GetVideoJobStatusUseCase.name))
  );
  c.register(CompleteVideoJobController.name, new CompleteVideoJobController(c.resolve(CompleteVideoJobUseCase.name)));
  c.register(
    GetVideoJobDownloadUrlController.name,
    new GetVideoJobDownloadUrlController(c.resolve(GetVideoJobDownloadUrlUseCase.name))
  );
  c.register(ListVideoJobsController.name, new ListVideoJobsController(c.resolve(ListVideoJobsUseCase.name)));
  c.register(CancelVideoJobController.name, new CancelVideoJobController(c.resolve(CancelVideoJobUseCase.name)));
  c.register(
    GetVideoJobEventsController.name,
    new GetVideoJobEventsController(
      c.resolve(GetVideoJobStatusUseCase.name),
      c.resolve(RedisJobEventSubscriberService.name),
      c.resolve(SseStreamRegistry.name)
    )
  );
  c.register(ReadinessController.name, new ReadinessController(c.resolve(CheckReadinessUseCase.name)));
}
