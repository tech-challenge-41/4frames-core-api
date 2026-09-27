import { createRedisClient, type Redis } from '@4frames/shared/redis';

import { type IDependencyHealthIndicator } from '@/domain/ports/service/dependency-health.service.interface';
import { type ILogger } from '@/domain/ports/service/logger.interface';

export interface RedisHealthServiceOptions {
  logger: ILogger;
  client?: Redis;
}

/**
 * Redis responde a PING. A API usa o Redis no SSE (uma conexão por stream, abertas sob demanda), então a
 * verificação tem um cliente próprio, aberto no primeiro PING e reaproveitado a cada probe.
 */
export class RedisHealthService implements IDependencyHealthIndicator {
  public readonly name = 'redis';

  private readonly client: Redis;

  constructor({ logger, client }: RedisHealthServiceOptions) {
    // maxRetriesPerRequest 1: com o Redis fora, o PING falha logo em vez de esperar 20 reconexões.
    this.client = client ?? createRedisClient(undefined, { maxRetriesPerRequest: 1 });

    const log = logger.child({ component: RedisHealthService.name });

    // Sem listener, o ioredis escreve cada falha de reconexão no console. A readiness já registra a falha.
    this.client.on('error', (error: Error) => log.debug('Redis health connection error', { error: error.message }));
  }

  public async check(): Promise<void> {
    const reply = await this.client.ping();

    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${reply}`);
    }
  }

  /** No encerramento: `disconnect` não espera resposta, então não trava com o Redis fora do ar. */
  public close(): void {
    this.client.disconnect();
  }
}
