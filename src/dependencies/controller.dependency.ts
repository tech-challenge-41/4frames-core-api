import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { AuthController } from '@/infra/http/controller/auth/auth.controller';

import { type Container } from './container';

export async function controllerDependency(c: Container) {
  c.register(AuthController.name, new AuthController(c.resolve(AuthenticateUserUseCase.name)));
}
