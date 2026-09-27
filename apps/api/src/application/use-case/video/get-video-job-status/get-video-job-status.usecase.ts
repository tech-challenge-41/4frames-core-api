import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IJobProgressReader } from '@/domain/ports/service/job-progress-reader.service.interface';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type GetVideoJobStatusInputDTO, type GetVideoJobStatusOutputDTO } from './get-video-job-status.dto';

interface GetVideoJobStatusUseCaseDependencies {
  videoJobService: IVideoJobService;
  jobProgressReader: IJobProgressReader;
}

export class GetVideoJobStatusUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;
  private readonly jobProgressReader: IJobProgressReader;

  constructor({ videoJobService, jobProgressReader }: GetVideoJobStatusUseCaseDependencies) {
    this.videoJobService = videoJobService;
    this.jobProgressReader = jobProgressReader;
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

    // Só PROCESSING, como na listagem: depois do DONE o worker deixa 100 guardado por uma hora.
    const progress =
      job.status === 'PROCESSING' ? (await this.jobProgressReader.getMany([job.id])).get(job.id) : undefined;

    return {
      jobId: job.id,
      status: job.status,
      fileName: job.fileName,
      ...(job.failureReason ? { failureReason: job.failureReason } : {}),
      ...(progress !== undefined ? { progress } : {})
    };
  }
}
