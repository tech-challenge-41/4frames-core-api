import http from 'node:http';
import { type AddressInfo } from 'node:net';

import { type Logger } from '@4frames/shared/logger';

export interface HealthServerOptions {
  port: number;
  /** true enquanto o laço de consumo está vivo. */
  isAlive: () => boolean;
  logger: Logger;
  host?: string;
}

/**
 * Servidor HTTP mínimo para a liveness probe do Kubernetes: `GET /healthz` → 200 ou 503.
 * A mesma porta recebe o `/metrics` no Card 10.
 */
export class HealthServer {
  private readonly server: http.Server;
  private readonly port: number;
  private readonly host?: string;
  private readonly logger: Logger;

  constructor({ port, isAlive, logger, host }: HealthServerOptions) {
    this.port = port;
    this.host = host;
    this.logger = logger;
    this.server = http.createServer((req, res) => {
      const pathname = (req.url ?? '/').split('?')[0];

      if (pathname !== '/healthz' || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'not_found' }));
        return;
      }

      const alive = isAlive();

      res
        .writeHead(alive ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: alive ? 'ok' : 'unavailable' }));
    });
  }

  /** Começa a ouvir e devolve a porta efetiva (útil com porta 0 nos testes). */
  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        const { port } = this.server.address() as AddressInfo;
        this.logger.info('Health server listening', { port, path: '/healthz' });
        resolve(port);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }

      this.server.close(error => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
    });
  }
}
