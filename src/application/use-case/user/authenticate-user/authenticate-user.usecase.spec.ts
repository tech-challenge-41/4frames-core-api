import { AuthError } from '@/application/error/auth-error';
import { type IUserAuthenticatorService } from '@/domain/ports/service/user-authenticator.service.interface';

import { AuthenticateUserUseCase } from './authenticate-user.usecase';

describe('AuthenticateUserUseCase', () => {
  let useCase: AuthenticateUserUseCase;
  let userAuthenticatorService: jest.Mocked<IUserAuthenticatorService>;

  beforeEach(() => {
    userAuthenticatorService = {
      authenticate: jest.fn()
    };

    useCase = new AuthenticateUserUseCase({
      userAuthenticatorService
    });
  });

  it('should authenticate user successfully', async () => {
    const email = 'test@example.com';
    const password = 'password123';
    const session = {
      accessToken: 'jwt-token',
      expireIn: 21600,
      user: {
        id: 1,
        email: 'test@example.com'
      }
    };

    userAuthenticatorService.authenticate.mockResolvedValue(session);

    const result = await useCase.execute({ email, password });

    expect(userAuthenticatorService.authenticate).toHaveBeenCalledWith(email, password);
    expect(result).toEqual(session);
  });

  it('should propagate AuthError from authenticator service', async () => {
    const email = 'test@example.com';
    const password = 'wrong';

    userAuthenticatorService.authenticate.mockRejectedValue(new AuthError('Incorrect email or password'));

    await expect(useCase.execute({ email, password })).rejects.toThrow(AuthError);
    expect(userAuthenticatorService.authenticate).toHaveBeenCalledWith(email, password);
  });
});
