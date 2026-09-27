import { type Server } from 'node:http';

import { prisma } from '@4frames/shared/prisma';
import { type Redis } from '@4frames/shared/redis';
import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';

import { Container } from '@/dependencies/container';
import { appLogger } from '@/infra/logging/application-logger';
import { createHttpRequestLoggerMiddleware } from '@/infra/logging/pino/http-request-logger.middleware';
import { REDIS_COMMAND_CLIENT_KEY } from '@/infra/services/redis-command-client';

import { openapi } from './docs/openapi';
import { errorHandler } from './middlewares/error-handler.middleware';
import { requestCorrelationMiddleware } from './middlewares/request-correlation.middleware';
import { routes as httpRoutes } from './route';
import { HttpShutdown } from './shutdown/http-shutdown';
import { SseStreamRegistry } from './shutdown/sse-stream-registry';

export interface HttpInitializeOptions {
  /** Prazo para as requisições em curso terminarem no encerramento (ver infra/config/shutdown.config.ts). */
  drainTimeoutMs: number;
}

export interface HttpApplication {
  server: Server;
  /** Encerramento gracioso: chamado no SIGTERM, por registerGracefulShutdown. */
  shutdown: () => Promise<void>;
}

export async function HTTPInitialize({ drainTimeoutMs }: HttpInitializeOptions): Promise<HttpApplication> {
  const app = express();

  const trustProxy = process.env.TRUST_PROXY === 'false' || process.env.TRUST_PROXY === '0' ? false : 1;

  app.set('trust proxy', trustProxy);

  const PORT = Number(process.env.PORT) || 3000;

  const container = Container.getInstance();
  await container.init();

  const httpShutdown = new HttpShutdown({
    sseStreams: container.resolve<SseStreamRegistry>(SseStreamRegistry.name),
    logger: appLogger.child({ component: HttpShutdown.name }),
    drainTimeoutMs,
    closeResources: async () => {
      // disconnect não espera resposta, então não trava com o Redis fora do ar.
      container.resolve<Redis>(REDIS_COMMAND_CLIENT_KEY).disconnect();
      await prisma.$disconnect();
    }
  });

  app.use(httpShutdown.connectionCloseMiddleware);
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

  // Espera a porta abrir: um EADDRINUSE rejeita aqui e o bootstrap sai com 1, em vez de virar um evento solto.
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(PORT, () => {
      listening.off('error', reject);
      resolve(listening);
    });
    listening.once('error', reject);
  });

  appLogger.info('HTTP server listening', { port: PORT });

  return { server, shutdown: () => httpShutdown.run(server) };
}
