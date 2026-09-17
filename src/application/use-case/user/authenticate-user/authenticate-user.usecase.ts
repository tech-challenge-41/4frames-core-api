import { type IUserAuthenticatorService } from '@/domain/ports/service/user-authenticator.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type AuthenticateUserOutputDTO } from './authenticate-user.dto';

interface AuthenticateUserUseCaseDependencies {
  userAuthenticatorService: IUserAuthenticatorService;
}

export class AuthenticateUserUseCase implements IUseCase {
  private readonly userAuthenticatorService: IUserAuthenticatorService;

  constructor({ userAuthenticatorService }: AuthenticateUserUseCaseDependencies) {
    this.userAuthenticatorService = userAuthenticatorService;
  }

  public async execute({ email, password }: { email: string; password: string }): Promise<AuthenticateUserOutputDTO> {
    return this.userAuthenticatorService.authenticate(email, password);
  }
}
