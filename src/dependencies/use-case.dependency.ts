import { AuthenticateUserUseCase } from '@/application/use-case/user/authenticate-user/authenticate-user.usecase';
import { UserAuthenticatorService } from '@/infra/services/user-authenticator.service';

import { type Container } from './container';

export async function useCaseDependency(c: Container) {
  c.register(
    AuthenticateUserUseCase.name,
    new AuthenticateUserUseCase({
      userAuthenticatorService: c.resolve(UserAuthenticatorService.name)
    })
  );
}
