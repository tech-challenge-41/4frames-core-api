import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type CancelVideoJobInputDTO, type CancelVideoJobOutputDTO } from './cancel-video-job.dto';

const CANCELABLE_STATUSES = ['UPLOAD_PENDING', 'QUEUED'];

interface CancelVideoJobUseCaseDependencies {
  videoJobService: IVideoJobService;
}

export class CancelVideoJobUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;

  constructor({ videoJobService }: CancelVideoJobUseCaseDependencies) {
    this.videoJobService = videoJobService;
  }

  public async execute({ userId, jobId }: CancelVideoJobInputDTO): Promise<CancelVideoJobOutputDTO> {
    const job = await this.videoJobService.findById(jobId);

    if (!job || job.userId !== userId) {
      throw new DomainError({
        message: 'Video job not found',
        type: DomainErrorTypes.NOT_FOUND,
        context: CancelVideoJobUseCase.name
      });
    }

    if (!CANCELABLE_STATUSES.includes(job.status)) {
      throw new DomainError({
        message: 'Video job can no longer be canceled',
        type: DomainErrorTypes.INVALID_STATE,
        context: CancelVideoJobUseCase.name,
        data: { status: job.status }
      });
    }

    const canceledJob = await this.videoJobService.cancelIfPending(jobId, userId);

    if (!canceledJob) {
      // O status ainda parecia cancelável na leitura acima, mas a escrita condicional não bateu:
      // o worker venceu a corrida (ex.: markProcessing) entre o findById e agora.
      throw new DomainError({
        message: 'Video job started processing before it could be canceled',
        type: DomainErrorTypes.INVALID_STATE,
        context: CancelVideoJobUseCase.name,
        data: { jobId }
      });
    }

    return {
      jobId: canceledJob.id,
      status: canceledJob.status
    };
  }
}
