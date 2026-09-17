import Redis, { type RedisOptions } from 'ioredis';

import { parseEnv, redisEnvSchema } from '../env';

export { Redis, type RedisOptions };

/**
 * Cria um cliente Redis sem conectar (`lazyConnect`): a conexão abre no primeiro comando ou em `connect()`.
 * Para SUBSCRIBE use um cliente dedicado, porque a conexão em modo subscriber não aceita outros comandos.
 */
export function createRedisClient(url?: string, options: RedisOptions = {}): Redis {
  const redisUrl = url ?? parseEnv(redisEnvSchema).REDIS_URL;

  return new Redis(redisUrl, { lazyConnect: true, ...options });
}
