import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import {
  type GetVideoJobDownloadUrlInputDTO,
  type GetVideoJobDownloadUrlOutputDTO
} from './get-video-job-download-url.dto';

const DEFAULT_DOWNLOAD_URL_EXPIRES_IN_SECONDS = 5 * 60;

interface GetVideoJobDownloadUrlUseCaseDependencies {
  videoJobService: IVideoJobService;
  videoStorageService: IVideoStorageService;
  /** Validade da URL pré-assinada (DOWNLOAD_URL_TTL_SECONDS, lido no composition root). */
  downloadUrlExpiresInSeconds?: number;
}

export class GetVideoJobDownloadUrlUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;
  private readonly videoStorageService: IVideoStorageService;
  private readonly downloadUrlExpiresInSeconds: number;

  constructor({
    videoJobService,
    videoStorageService,
    downloadUrlExpiresInSeconds = DEFAULT_DOWNLOAD_URL_EXPIRES_IN_SECONDS
  }: GetVideoJobDownloadUrlUseCaseDependencies) {
    this.videoJobService = videoJobService;
    this.videoStorageService = videoStorageService;
    this.downloadUrlExpiresInSeconds = downloadUrlExpiresInSeconds;
  }

  public async execute({ userId, jobId }: GetVideoJobDownloadUrlInputDTO): Promise<GetVideoJobDownloadUrlOutputDTO> {
    const job = await this.videoJobService.findById(jobId);

    if (!job || job.userId !== userId) {
      throw new DomainError({
        message: 'Video job not found',
        type: DomainErrorTypes.NOT_FOUND,
        context: GetVideoJobDownloadUrlUseCase.name
      });
    }

    if (job.status !== 'DONE') {
      throw new DomainError({
        message: 'Video job is not done yet',
        type: DomainErrorTypes.INVALID_STATE,
        context: GetVideoJobDownloadUrlUseCase.name,
        data: { status: job.status }
      });
    }

    if (!job.zipKey) {
      throw new DomainError({
        message: 'Video job is done but has no zip file available',
        type: DomainErrorTypes.PRECONDITION_FAILED,
        context: GetVideoJobDownloadUrlUseCase.name,
        data: { jobId: job.id }
      });
    }

    const { downloadUrl, expiresIn } = await this.videoStorageService.generatePresignedDownloadUrl(
      job.zipKey,
      this.downloadUrlExpiresInSeconds
    );

    return { downloadUrl, expiresIn };
  }
}
