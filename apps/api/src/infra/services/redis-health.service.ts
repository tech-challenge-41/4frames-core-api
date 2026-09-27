import { type Redis } from '@4frames/shared/redis';

import { type IDependencyHealthIndicator } from '@/domain/ports/service/dependency-health.service.interface';

export interface RedisHealthServiceOptions {
  /** O cliente de comandos da API (redis-command-client.ts): o PING prova a conexão que o progresso usa. */
  client: Redis;
}

/** Redis responde a PING. */
export class RedisHealthService implements IDependencyHealthIndicator {
  public readonly name = 'redis';

  private readonly client: Redis;

  constructor({ client }: RedisHealthServiceOptions) {
    this.client = client;
  }

  public async check(): Promise<void> {
    const reply = await this.client.ping();

    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${reply}`);
    }
  }
}
