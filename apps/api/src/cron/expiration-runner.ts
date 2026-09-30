import { type ExpireAbandonedUploadsOutputDTO } from '@/application/use-case/video/expire-abandoned-uploads/expire-abandoned-uploads.dto';
import { type ILogger } from '@/domain/ports/service/logger.interface';
import { type IUseCase } from '@/domain/ports/use-case';

/** Intervalo do modo laço, o mesmo do CronJob no cluster. */
export const EXPIRATION_INTERVAL_MS = 60_000;

export interface ExpirationRunnerOptions {
  useCase: IUseCase<void, ExpireAbandonedUploadsOutputDTO>;
  logger: ILogger;
  intervalMs?: number;
}

/**
 * Executa a expiração de uploads abandonados em dois modos: `runOnce` (uma passada, para o CronJob do cluster)
 * e `start`/`stop` (uma passada a cada `intervalMs`, para o desenvolvimento). No laço, uma passada que falha
 * só é registrada: a próxima tenta de novo.
 */
export class ExpirationRunner {
  private readonly useCase: IUseCase<void, ExpireAbandonedUploadsOutputDTO>;
  private readonly logger: ILogger;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;

  constructor({ useCase, logger, intervalMs = EXPIRATION_INTERVAL_MS }: ExpirationRunnerOptions) {
    this.useCase = useCase;
    this.logger = logger.child({ component: ExpirationRunner.name });
    this.intervalMs = intervalMs;
  }

  public async runOnce(): Promise<ExpireAbandonedUploadsOutputDTO> {
    const result = await this.useCase.execute();

    this.logger.info('Expiration pass finished', {
      expired: result.expired,
      stuckProcessing: result.stuckProcessing
    });

    return result;
  }

  /** Uma passada agora e depois a cada `intervalMs`, uma de cada vez. */
  public start(): void {
    if (this.timer) {
      return;
    }

    this.logger.info('Expiration loop started', { intervalMs: this.intervalMs });
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  /** Para o laço e espera a passada em andamento terminar. */
  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.current;
  }

  private tick(): void {
    // Uma passada mais longa que o intervalo não se sobrepõe à seguinte.
    if (this.current) {
      return;
    }

    this.current = this.runOnce()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error('Expiration pass failed', error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.current = null;
      });
  }
}
