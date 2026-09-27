import { type Server } from 'node:http';

import { type RequestHandler } from 'express';

import { type ILogger } from '@/domain/ports/service/logger.interface';

import { type SseStreamRegistry } from './sse-stream-registry';

/** De quanto em quanto tempo o encerramento fecha as conexões keep-alive que ficaram ociosas. */
const IDLE_SWEEP_INTERVAL_MS = 250;

export interface HttpShutdownOptions {
  sseStreams: SseStreamRegistry;
  logger: ILogger;
  /** Prazo para as requisições em curso terminarem. Depois dele, as conexões restantes são fechadas. */
  drainTimeoutMs: number;
  /** Fecha o que a API mantém aberto além do servidor HTTP (Prisma, Redis). */
  closeResources: () => Promise<void>;
}

/**
 * Encerramento gracioso do servidor HTTP da API, chamado no SIGTERM:
 * 1. para de aceitar conexões, e cada resposta passa a sair com `Connection: close`;
 * 2. termina os streams SSE, e o EventSource reconecta em outra réplica;
 * 3. espera as requisições em curso, até `drainTimeoutMs`;
 * 4. fecha Prisma e Redis.
 */
export class HttpShutdown {
  private draining = false;

  constructor(private readonly options: HttpShutdownOptions) {}

  /** Registrado antes das rotas: durante o encerramento, o Ingress não reaproveita a conexão com esta réplica. */
  public readonly connectionCloseMiddleware: RequestHandler = (_request, response, next) => {
    if (this.draining) {
      response.setHeader('Connection', 'close');
    }

    next();
  };

  public async run(server: Server): Promise<void> {
    const { sseStreams, logger, closeResources } = this.options;

    this.draining = true;
    const serverClosed = this.closeServer(server);

    const streams = await sseStreams.closeAll();
    logger.info('SSE streams closed', { streams });

    await serverClosed;
    logger.info('HTTP server closed');

    await closeResources();
  }

  private closeServer(server: Server): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Uma conexão keep-alive fica aberta e ociosa depois da última resposta, e o close esperaria por ela.
      const idleSweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_INTERVAL_MS);
      const deadline = setTimeout(() => {
        this.options.logger.warn('Drain timeout reached, closing remaining connections', {
          drainTimeoutMs: this.options.drainTimeoutMs
        });
        server.closeAllConnections();
      }, this.options.drainTimeoutMs);

      server.close(error => {
        clearInterval(idleSweep);
        clearTimeout(deadline);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}
