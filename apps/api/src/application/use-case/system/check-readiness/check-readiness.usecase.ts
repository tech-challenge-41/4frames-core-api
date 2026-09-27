import { type IDependencyHealthIndicator } from '@/domain/ports/service/dependency-health.service.interface';
import { type ILogger } from '@/domain/ports/service/logger.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type CheckReadinessOutputDTO, type DependencyStatus } from './check-readiness.dto';

/** Abaixo do timeout da readiness probe (3 s): um banco que não responde vira 503, e não uma probe sem resposta. */
export const DEFAULT_DEPENDENCY_CHECK_TIMEOUT_MS = 2_000;

interface CheckReadinessUseCaseDependencies {
  indicators: IDependencyHealthIndicator[];
  logger: ILogger;
  timeoutMs?: number;
}

/** Readiness da API: pronta só quando todas as dependências respondem, cada uma com prazo próprio. */
export class CheckReadinessUseCase implements IUseCase<void, CheckReadinessOutputDTO> {
  private readonly indicators: IDependencyHealthIndicator[];
  private readonly logger: ILogger;
  private readonly timeoutMs: number;

  constructor({
    indicators,
    logger,
    timeoutMs = DEFAULT_DEPENDENCY_CHECK_TIMEOUT_MS
  }: CheckReadinessUseCaseDependencies) {
    this.indicators = indicators;
    this.logger = logger.child({ component: CheckReadinessUseCase.name });
    this.timeoutMs = timeoutMs;
  }

  public async execute(): Promise<CheckReadinessOutputDTO> {
    const results = await Promise.all(
      this.indicators.map(async indicator => [indicator.name, await this.probe(indicator)] as const)
    );

    return {
      ready: results.every(([, status]) => status === 'up'),
      checks: Object.fromEntries(results)
    };
  }

  private async probe(indicator: IDependencyHealthIndicator): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No response after ${this.timeoutMs}ms`)), this.timeoutMs);
    });

    try {
      await Promise.race([indicator.check(), timeout]);
      return 'up';
    } catch (error) {
      this.logger.warn('Readiness check failed', {
        dependency: indicator.name,
        error: error instanceof Error ? error.message : String(error)
      });
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
