import { createRedisClient, type Redis } from '@4frames/shared/redis';

import { type ILogger } from '@/domain/ports/service/logger.interface';

export const REDIS_COMMAND_CLIENT_KEY = 'RedisCommandClient' as const;

/** Espera máxima por um comando: o progresso é opcional e não pode atrasar a listagem. */
export const REDIS_COMMAND_TIMEOUT_MS = 1_000;

/**
 * Cliente Redis de comandos da API, compartilhado pelo PING do `/ready` e pelo MGET do progresso. O SSE não o
 * usa: cada stream abre a própria conexão, porque em modo subscriber ela deixa de aceitar outros comandos.
 */
export function createRedisCommandClient(logger: ILogger): Redis {
  // Com o Redis fora ou lento, o comando falha logo em vez de esperar 20 reconexões.
  const client = createRedisClient(undefined, { maxRetriesPerRequest: 1, commandTimeout: REDIS_COMMAND_TIMEOUT_MS });
  const log = logger.child({ component: 'RedisCommandClient' });

  // Sem listener, o ioredis escreve cada falha de reconexão no console. Quem usa o cliente registra a falha.
  client.on('error', (error: Error) => log.debug('Redis command connection error', { error: error.message }));

  return client;
}
