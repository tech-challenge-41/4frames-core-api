import { type PrismaClient } from '@4frames/shared/prisma';

import { type CompletedJobData, type VideoJobRepository, type VideoJobSnapshot } from '../processing/ports';

type VideoJobsDelegate = Pick<PrismaClient['video_jobs'], 'findUnique' | 'updateMany'>;

/**
 * Transições com `updateMany` condicionado ao status atual: com entrega duplicada ou duas réplicas,
 * só uma escrita vence e a outra recebe `false`.
 */
export class PrismaVideoJobRepository implements VideoJobRepository {
  constructor(private readonly videoJobs: VideoJobsDelegate) {}

  public async findById(jobId: string): Promise<VideoJobSnapshot | null> {
    const job = await this.videoJobs.findUnique({
      where: { id: jobId },
      select: { id: true, user_id: true, status: true }
    });

    return job ? { id: job.id, userId: job.user_id, status: job.status } : null;
  }

  public async markProcessing(jobId: string): Promise<boolean> {
    // PROCESSING também é aceito: é o job de um worker que caiu, cuja mensagem voltou à fila.
    const { count } = await this.videoJobs.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'PROCESSING', failure_reason: null }
    });

    return count === 1;
  }

  public async markDone(jobId: string, { zipKey, frameCount, durationSeconds }: CompletedJobData): Promise<boolean> {
    const { count } = await this.videoJobs.updateMany({
      where: { id: jobId, status: 'PROCESSING' },
      data: {
        status: 'DONE',
        zip_key: zipKey,
        frame_count: frameCount,
        duration_seconds: durationSeconds,
        failure_reason: null
      }
    });

    return count === 1;
  }

  public async markFailed(jobId: string, reason: string): Promise<boolean> {
    const { count } = await this.videoJobs.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'FAILED', failure_reason: reason }
    });

    return count === 1;
  }
}
