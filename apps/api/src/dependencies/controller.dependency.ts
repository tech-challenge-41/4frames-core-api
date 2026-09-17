import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { CompleteVideoJobUseCase } from '@/application/use-case/video/complete-video-job/complete-video-job.usecase';
import { CreateVideoJobUseCase } from '@/application/use-case/video/create-video-job/create-video-job.usecase';
import { GetVideoJobStatusUseCase } from '@/application/use-case/video/get-video-job-status/get-video-job-status.usecase';
import { AuthController } from '@/infra/http/controller/auth/auth.controller';
import { CompleteVideoJobController } from '@/infra/http/controller/video/complete-video-job.controller';
import { GetVideoJobStatusController } from '@/infra/http/controller/video/get-video-job-status.controller';
import { VideoController } from '@/infra/http/controller/video/video.controller';

import { type Container } from './container';

export async function controllerDependency(c: Container) {
  c.register(AuthController.name, new AuthController(c.resolve(AuthenticateUserUseCase.name)));
  c.register(VideoController.name, new VideoController(c.resolve(CreateVideoJobUseCase.name)));
  c.register(
    GetVideoJobStatusController.name,
    new GetVideoJobStatusController(c.resolve(GetVideoJobStatusUseCase.name))
  );
  c.register(CompleteVideoJobController.name, new CompleteVideoJobController(c.resolve(CompleteVideoJobUseCase.name)));
}
