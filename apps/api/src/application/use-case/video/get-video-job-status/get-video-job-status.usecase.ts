import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type GetVideoJobStatusInputDTO, type GetVideoJobStatusOutputDTO } from './get-video-job-status.dto';

interface GetVideoJobStatusUseCaseDependencies {
  videoJobService: IVideoJobService;
}

export class GetVideoJobStatusUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;

  constructor({ videoJobService }: GetVideoJobStatusUseCaseDependencies) {
    this.videoJobService = videoJobService;
  }

  public async execute({ userId, jobId }: GetVideoJobStatusInputDTO): Promise<GetVideoJobStatusOutputDTO> {
    const job = await this.videoJobService.findById(jobId);

    if (!job || job.userId !== userId) {
      throw new DomainError({
        message: 'Video job not found',
        type: DomainErrorTypes.NOT_FOUND,
        context: GetVideoJobStatusUseCase.name
      });
    }

    return {
      jobId: job.id,
      status: job.status,
      fileName: job.fileName,
      ...(job.failureReason ? { failureReason: job.failureReason } : {})
    };
  }
}
