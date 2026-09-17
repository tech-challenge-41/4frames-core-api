import { AuthError } from '@/application/error/auth-error';
import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import {
  type AuthenticatedRequestUser,
  type IJwtAuthenticatorService
} from '@/domain/ports/service/jwt-authenticator.service.interface';
import { authenticateJwt } from '@/infra/lib/jwt-authentication/jwt-authenticator';

export class JwtAuthenticatorService implements IJwtAuthenticatorService {
  public async verifyAuthorizationHeader(authorizationHeader: string | undefined): Promise<AuthenticatedRequestUser> {
    const payload = authenticateJwt(authorizationHeader);

    if (payload.valid) {
      return { userId: payload.userId };
    }

    if (payload.reason === 'JWT_NOT_CONFIGURED') {
      throw new DomainError({
        message: 'JWT authenticator is not configured',
        type: DomainErrorTypes.PRECONDITION_FAILED,
        context: JwtAuthenticatorService.name,
        data: { reason: payload.reason }
      });
    }

    throw new AuthError(payload.message, { reason: payload.reason });
  }
}
