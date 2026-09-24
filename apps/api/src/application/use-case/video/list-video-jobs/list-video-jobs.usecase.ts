import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type ListVideoJobsInputDTO, type ListVideoJobsOutputDTO } from './list-video-jobs.dto';

interface ListVideoJobsUseCaseDependencies {
  videoJobService: IVideoJobService;
}

export class ListVideoJobsUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;

  constructor({ videoJobService }: ListVideoJobsUseCaseDependencies) {
    this.videoJobService = videoJobService;
  }

  public async execute({ userId, limit, offset }: ListVideoJobsInputDTO): Promise<ListVideoJobsOutputDTO> {
    const { items, total } = await this.videoJobService.listByUser(userId, { limit, offset });

    return {
      items: items.map(job => ({
        jobId: job.id,
        fileName: job.fileName,
        status: job.status,
        createdAt: job.createdAt,
        ...(job.failureReason ? { failureReason: job.failureReason } : {}),
        hasDownload: job.status === 'DONE' && !!job.zipKey
      })),
      total,
      limit,
      offset
    };
  }
}
