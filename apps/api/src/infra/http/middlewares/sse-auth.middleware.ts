import { type NextFunction, type Request, type Response } from 'express';

import { AuthError } from '@/application/error/auth-error';
import { Container } from '@/dependencies/container';
import { type IJwtAuthenticatorService } from '@/domain/ports/service/jwt-authenticator.service.interface';
import { appLogger } from '@/infra/logging/application-logger';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';

/**
 * Variante de authMiddleware só para a rota SSE (GET /videos/:jobId/events): o EventSource nativo do
 * navegador não permite headers customizados, então o Authorization: Bearer usado nas outras rotas não
 * chega aqui — o token vem em `?token=`. Isso não substitui authMiddleware nas outras rotas: token em
 * query string pode vazar em logs de acesso, histórico do navegador e proxies intermediários, então
 * esse caminho fica restrito a esta única rota (server-sent events não tem alternativa melhor sem um
 * handshake extra). Um `Authorization` header ainda é aceito primeiro, para curl/testes manuais.
 */
export const sseAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const log = appLogger.child({ component: 'SseAuthMiddleware' });
  const container = Container.getInstance();
  const jwtAuthenticator = container.resolve<IJwtAuthenticatorService>(JwtAuthenticatorService.name);

  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const authorizationHeader = req.headers.authorization ?? (queryToken ? `Bearer ${queryToken}` : undefined);

  try {
    const { userId } = await jwtAuthenticator.verifyAuthorizationHeader(authorizationHeader);

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
