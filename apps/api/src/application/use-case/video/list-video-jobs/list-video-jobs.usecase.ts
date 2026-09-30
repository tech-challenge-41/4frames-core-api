import { type IJobProgressReader } from '@/domain/ports/service/job-progress-reader.service.interface';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type ListVideoJobsInputDTO, type ListVideoJobsOutputDTO } from './list-video-jobs.dto';

interface ListVideoJobsUseCaseDependencies {
  videoJobService: IVideoJobService;
  jobProgressReader: IJobProgressReader;
}

export class ListVideoJobsUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;
  private readonly jobProgressReader: IJobProgressReader;

  constructor({ videoJobService, jobProgressReader }: ListVideoJobsUseCaseDependencies) {
    this.videoJobService = videoJobService;
    this.jobProgressReader = jobProgressReader;
  }

  public async execute({ userId, limit, offset }: ListVideoJobsInputDTO): Promise<ListVideoJobsOutputDTO> {
    const { items, total } = await this.videoJobService.listByUser(userId, { limit, offset });

    // Só PROCESSING: o worker deixa 100 guardado depois do DONE, e a lista não deve mostrar barra em job pronto.
    const isProcessing = (status: string) => status === 'PROCESSING';
    const progress = await this.jobProgressReader.getMany(
      items.filter(job => isProcessing(job.status)).map(job => job.id)
    );

    return {
      items: items.map(job => ({
        jobId: job.id,
        fileName: job.fileName,
        status: job.status,
        createdAt: job.createdAt,
        ...(job.failureReason ? { failureReason: job.failureReason } : {}),
        hasDownload: job.status === 'DONE' && !!job.zipKey,
        ...(isProcessing(job.status) && progress.has(job.id) ? { progress: progress.get(job.id) } : {})
      })),
      total,
      limit,
      offset
    };
  }
}
