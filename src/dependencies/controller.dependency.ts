import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { CreateVideoJobUseCase } from '@/application/use-case/video/create-video-job/create-video-job.usecase';
import { AuthController } from '@/infra/http/controller/auth/auth.controller';
import { VideoController } from '@/infra/http/controller/video/video.controller';

import { type Container } from './container';

export async function controllerDependency(c: Container) {
  c.register(AuthController.name, new AuthController(c.resolve(AuthenticateUserUseCase.name)));
  c.register(VideoController.name, new VideoController(c.resolve(CreateVideoJobUseCase.name)));
}
