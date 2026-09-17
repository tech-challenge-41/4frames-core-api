import { type Request, type Response, type NextFunction } from 'express';

import { AuthError } from '@/application/error/auth-error';
import { Container } from '@/dependencies/container';
import { type IJwtAuthenticatorService } from '@/domain/ports/service/jwt-authenticator.service.interface';
import { appLogger } from '@/infra/logging/application-logger';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const log = appLogger.child({ component: 'AuthMiddleware' });
  const container = Container.getInstance();
  const jwtAuthenticator = container.resolve<IJwtAuthenticatorService>(JwtAuthenticatorService.name);

  try {
    const { userId } = await jwtAuthenticator.verifyAuthorizationHeader(req.headers.authorization);

    req.authenticated = { userId };
    next();
  } catch (error: Error | any) {
    if (error instanceof AuthError) {
      log.error(error.message, error, { reason: error.data?.reason });
      return res.status(401).json({ error: error.message });
    }

    log.error('Invalid token', error, {
      error: error.message || 'Invalid token'
    });
    return res.status(401).json({ error: error.message || 'Invalid token' });
  }
};
