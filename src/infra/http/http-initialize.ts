import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';

import { Container } from '@/dependencies/container';
import { appLogger } from '@/infra/logging/application-logger';
import { createHttpRequestLoggerMiddleware } from '@/infra/logging/pino/http-request-logger.middleware';

import { openapi } from './docs/openapi';
import { errorHandler } from './middlewares/error-handler.middleware';
import { requestCorrelationMiddleware } from './middlewares/request-correlation.middleware';
import { routes as httpRoutes } from './route';

export async function HTTPInitialize() {
  const app = express();

  const trustProxy = process.env.TRUST_PROXY === 'false' || process.env.TRUST_PROXY === '0' ? false : 1;

  app.set('trust proxy', trustProxy);

  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(requestCorrelationMiddleware);
  app.use(createHttpRequestLoggerMiddleware());

  const container = Container.getInstance();
  await container.init();

  app.use(express.json());
  app.use(httpRoutes);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.get('/health-check', (req: express.Request, res: express.Response) => {
    res.status(200).json({ message: 'Server is running' });
  });

  app.use(errorHandler);

  app.listen(PORT, () => {
    appLogger.info('HTTP server listening', { port: PORT });
  });
}
