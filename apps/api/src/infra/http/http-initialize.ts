import { type Server } from 'node:http';

import { prisma } from '@4frames/shared/prisma';
import { type Redis } from '@4frames/shared/redis';

import { Container } from '@/dependencies/container';
import { appLogger } from '@/infra/logging/application-logger';
import { REDIS_COMMAND_CLIENT_KEY } from '@/infra/services/redis-command-client';

import { createHttpApp } from './http-app';
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

  const app = createHttpApp({ connectionCloseMiddleware: httpShutdown.connectionCloseMiddleware });

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
