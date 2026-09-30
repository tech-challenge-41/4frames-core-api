import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';

import { createHttpRequestLoggerMiddleware } from '@/infra/logging/pino/http-request-logger.middleware';

import { openapi } from './docs/openapi';
import { errorHandler } from './middlewares/error-handler.middleware';
import { requestCorrelationMiddleware } from './middlewares/request-correlation.middleware';
import { routes as httpRoutes } from './route';

export interface HttpAppOptions {
  /** `HttpShutdown.connectionCloseMiddleware`: responde com `Connection: close` durante o encerramento. */
  connectionCloseMiddleware: RequestHandler;
}

/**
 * Monta o app Express da API: middlewares, rotas, Swagger e tratamento de erro. Não inicia o Container nem abre
 * porta (isso fica em HTTPInitialize), então os testes HTTP usam o mesmo app que a API serve.
 *
 * Rota nova entra num router de `route/`, com a operação no OpenAPI: o teste de paridade
 * (`__tests__/openapi-parity.spec.ts`) falha se uma rota ficar sem documentação, ou o contrário.
 */
export function createHttpApp({ connectionCloseMiddleware }: HttpAppOptions): Express {
  const app = express();

  const trustProxy = process.env.TRUST_PROXY === 'false' || process.env.TRUST_PROXY === '0' ? false : 1;

  app.set('trust proxy', trustProxy);

  app.use(connectionCloseMiddleware);
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(requestCorrelationMiddleware);
  app.use(createHttpRequestLoggerMiddleware());

  app.use(express.json());
  app.use(httpRoutes);
  // O swagger-ui redireciona /api-docs para /api-docs/ com caminho absoluto, que perde o /api do Ingress.
  // O relativo (api-docs/) funciona atrás do Ingress e direto na porta 3000.
  app.get('/api-docs', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.endsWith('/')) {
      next();
      return;
    }

    res.redirect(301, 'api-docs/');
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.get('/health-check', (req: express.Request, res: express.Response) => {
    res.status(200).json({ message: 'Server is running' });
  });

  app.use(errorHandler);

  return app;
}
