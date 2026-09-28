import { type ILogger } from '@/domain/ports/service/logger.interface';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type ExpireAbandonedUploadsOutputDTO } from './expire-abandoned-uploads.dto';

/** Folga além da validade da URL de upload: um PUT que começou no último segundo ainda termina e confirma. */
export const EXPIRATION_MARGIN_SECONDS = 60;
/** PROCESSING sem escrita há mais tempo que isto é suspeito: o worker só grava no banco ao mudar de estado. */
export const STUCK_PROCESSING_AFTER_MS = 15 * 60_000;

interface ExpireAbandonedUploadsUseCaseDependencies {
  videoJobService: IVideoJobService;
  logger: ILogger;
  /** A mesma validade da URL pré-assinada de upload (UPLOAD_URL_TTL_SECONDS). */
  uploadUrlExpiresInSeconds: number;
  now?: () => Date;
}

/**
 * Uploads abandonados (ADR-001 §2.3): um job em UPLOAD_PENDING cuja URL de upload já venceu nunca vai receber
 * o arquivo, e vira EXPIRED. Roda fora das réplicas da API, uma execução por vez (CronJob `expire-uploads`).
 */
export class ExpireAbandonedUploadsUseCase implements IUseCase<void, ExpireAbandonedUploadsOutputDTO> {
  private readonly videoJobService: IVideoJobService;
  private readonly logger: ILogger;
  private readonly uploadUrlExpiresInSeconds: number;
  private readonly now: () => Date;

  constructor({
    videoJobService,
    logger,
    uploadUrlExpiresInSeconds,
    now = () => new Date()
  }: ExpireAbandonedUploadsUseCaseDependencies) {
    this.videoJobService = videoJobService;
    this.logger = logger.child({ component: ExpireAbandonedUploadsUseCase.name });
    this.uploadUrlExpiresInSeconds = uploadUrlExpiresInSeconds;
    this.now = now;
  }

  public async execute(): Promise<ExpireAbandonedUploadsOutputDTO> {
    const now = this.now().getTime();
    const createdBefore = new Date(now - (this.uploadUrlExpiresInSeconds + EXPIRATION_MARGIN_SECONDS) * 1000);
    const notUpdatedSince = new Date(now - STUCK_PROCESSING_AFTER_MS);

    const expired = await this.videoJobService.expireUploadPendingCreatedBefore(createdBefore);
    const stuckProcessing = await this.videoJobService.countProcessingNotUpdatedSince(notUpdatedSince);

    if (expired > 0) {
      this.logger.info('Abandoned uploads expired', { expired, createdBefore: createdBefore.toISOString() });
    }

    if (stuckProcessing > 0) {
      this.logger.warn('Jobs in PROCESSING without updates', {
        stuckProcessing,
        notUpdatedSince: notUpdatedSince.toISOString()
      });
    }

    return { expired, createdBefore, stuckProcessing };
  }
}
