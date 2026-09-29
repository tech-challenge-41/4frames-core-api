import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type CompleteVideoJobInputDTO, type CompleteVideoJobOutputDTO } from './complete-video-job.dto';
import { buildVideoSourceKey, contentTypeToExtension } from '../video-storage-key';

interface CompleteVideoJobUseCaseDependencies {
  videoJobService: IVideoJobService;
  videoStorageService: IVideoStorageService;
}

export class CompleteVideoJobUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;
  private readonly videoStorageService: IVideoStorageService;

  constructor({ videoJobService, videoStorageService }: CompleteVideoJobUseCaseDependencies) {
    this.videoJobService = videoJobService;
    this.videoStorageService = videoStorageService;
  }

  public async execute({ userId, jobId }: CompleteVideoJobInputDTO): Promise<CompleteVideoJobOutputDTO> {
    const job = await this.videoJobService.findById(jobId);

    if (!job || job.userId !== userId) {
      throw new DomainError({
        message: 'Video job not found',
        type: DomainErrorTypes.NOT_FOUND,
        context: CompleteVideoJobUseCase.name
      });
    }

    if (job.status !== 'UPLOAD_PENDING') {
      throw this.notAwaitingConfirmationError({ status: job.status });
    }

    const extension = contentTypeToExtension(job.contentType);

    if (!extension) {
      throw new DomainError({
        message: 'Video job has an unsupported content type',
        type: DomainErrorTypes.INVALID_STATE,
        context: CompleteVideoJobUseCase.name,
        data: { contentType: job.contentType }
      });
    }

    const key = buildVideoSourceKey(userId, job.id, extension);

    const objectExists = await this.videoStorageService.headObject(key);

    if (!objectExists) {
      throw new DomainError({
        message: 'Uploaded video object was not found in storage',
        type: DomainErrorTypes.PRECONDITION_FAILED,
        context: CompleteVideoJobUseCase.name,
        data: { key }
      });
    }

    const queuedJob = await this.videoJobService.queueIfUploadPending(jobId, userId);

    if (!queuedJob) {
      // O status ainda era UPLOAD_PENDING na leitura acima, mas a escrita condicional não bateu: um
      // cancelamento ou a rotina de expiração levou o job a EXPIRED entre o findById e agora.
      throw this.notAwaitingConfirmationError({ jobId });
    }

    return {
      jobId: queuedJob.id,
      status: queuedJob.status,
      fileName: queuedJob.fileName
    };
  }

  private notAwaitingConfirmationError(data: Record<string, unknown>): DomainError {
    return new DomainError({
      message: 'Video job is not awaiting upload confirmation',
      type: DomainErrorTypes.INVALID_STATE,
      context: CompleteVideoJobUseCase.name,
      data
    });
  }
}
