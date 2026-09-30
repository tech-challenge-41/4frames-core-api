import { jobProgressKey } from '@4frames/shared/jobs';
import { type Redis } from '@4frames/shared/redis';

import { type IJobProgressReader } from '@/domain/ports/service/job-progress-reader.service.interface';
import { type ILogger } from '@/domain/ports/service/logger.interface';

export interface RedisJobProgressReaderServiceOptions {
  client: Redis;
  logger: ILogger;
}

/** Lê o último percentual de vários jobs num único MGET em `progress:{jobId}`, a chave que o worker grava. */
export class RedisJobProgressReaderService implements IJobProgressReader {
  private readonly client: Redis;
  private readonly logger: ILogger;

  constructor({ client, logger }: RedisJobProgressReaderServiceOptions) {
    this.client = client;
    this.logger = logger.child({ component: RedisJobProgressReaderService.name });
  }

  public async getMany(jobIds: string[]): Promise<Map<string, number>> {
    const progress = new Map<string, number>();

    if (jobIds.length === 0) {
      return progress;
    }

    let values: (string | null)[];

    try {
      values = await this.client.mget(...jobIds.map(jobProgressKey));
    } catch (error) {
      // Best-effort: sem o Redis, a resposta sai sem o percentual, e o status do Postgres segue valendo.
      this.logger.warn('Failed to read job progress', {
        jobs: jobIds.length,
        error: error instanceof Error ? error.message : String(error)
      });
      return progress;
    }

    jobIds.forEach((jobId, index) => {
      const raw = values[index];
      const percent = raw === null || raw === undefined ? Number.NaN : Number(raw);

      if (Number.isFinite(percent)) {
        progress.set(jobId, Math.min(100, Math.max(0, percent)));
      }
    });

    return progress;
  }
}
