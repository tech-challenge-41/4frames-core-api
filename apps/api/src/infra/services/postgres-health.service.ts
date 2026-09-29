import { prisma } from '@4frames/shared/prisma';

import { type IDependencyHealthIndicator } from '@/domain/ports/service/dependency-health.service.interface';

/** Postgres responde a uma consulta pela mesma conexão (pool do Prisma) que a API usa para atender. */
export class PostgresHealthService implements IDependencyHealthIndicator {
  public readonly name = 'database';

  public async check(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  }
}
