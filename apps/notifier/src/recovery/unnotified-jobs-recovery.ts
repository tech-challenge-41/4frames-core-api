import { type Logger } from '@4frames/shared/logger';

import { type NotifyVideoJobTerminalUseCase } from '@/application/notify-video-job-terminal.usecase';
import { type PrismaVideoJobNotifierRepository } from '@/repo/video-job-notifier.repository';

export interface UnnotifiedJobsRecoveryOptions {
  repository: PrismaVideoJobNotifierRepository;
  useCase: NotifyVideoJobTerminalUseCase;
  logger: Logger;
  intervalMs: number;
  batchSize: number;
}

export class UnnotifiedJobsRecovery {
  private readonly repository: PrismaVideoJobNotifierRepository;
  private readonly useCase: NotifyVideoJobTerminalUseCase;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private timer?: ReturnType<typeof setInterval>;

  constructor({ repository, useCase, logger, intervalMs, batchSize }: UnnotifiedJobsRecoveryOptions) {
    this.repository = repository;
    this.useCase = useCase;
    this.logger = logger.child({ component: UnnotifiedJobsRecovery.name });
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
  }

  public start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    try {
      const jobs = await this.repository.listUnnotifiedTerminal(this.batchSize);

      for (const job of jobs) {
        try {
          await this.useCase.fromRecovery(job.jobId);
        } catch (error) {
          this.logger.error('Recovery notification failed', error instanceof Error ? error : undefined, {
            jobId: job.jobId,
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      this.logger.error('Recovery sweep failed', error instanceof Error ? error : undefined, {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
