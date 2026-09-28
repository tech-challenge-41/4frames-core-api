import { prisma, type video_jobs, type VideoJobStatus } from '@4frames/shared/prisma';

import {
  type CreateUploadPendingJobInput,
  type IVideoJobService,
  type ListByUserPagination,
  type ListByUserResult,
  type VideoJobRecord
} from '@/domain/ports/service/video-job.service.interface';

export class VideoJobService implements IVideoJobService {
  public async createUploadPendingJob({
    userId,
    fileName,
    contentType,
    fileSize
  }: CreateUploadPendingJobInput): Promise<VideoJobRecord> {
    const job = await prisma.video_jobs.create({
      data: {
        user_id: userId,
        file_name: fileName,
        content_type: contentType,
        file_size: BigInt(fileSize),
        status: 'UPLOAD_PENDING'
      }
    });

    return this.toRecord(job);
  }

  public async findById(jobId: string): Promise<VideoJobRecord | null> {
    const job = await prisma.video_jobs.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return null;
    }

    return this.toRecord(job);
  }

  public async updateStatus(jobId: string, status: string): Promise<VideoJobRecord> {
    const job = await prisma.video_jobs.update({
      where: { id: jobId },
      data: { status: status as VideoJobStatus }
    });

    return this.toRecord(job);
  }

  public async cancelIfPending(jobId: string, userId: number): Promise<VideoJobRecord | null> {
    // updateMany (não update) para a condição de status entrar no WHERE: se o worker já mudou o
    // job para PROCESSING entre o findById do use case e esta chamada, count vem 0 e não pisamos nele.
    const { count } = await prisma.video_jobs.updateMany({
      where: { id: jobId, user_id: userId, status: { in: ['UPLOAD_PENDING', 'QUEUED'] } },
      // Reaproveita EXPIRED (não cria um status CANCELLED novo/migration): ambos significam "job
      // terminal sem resultado, nunca vai virar DONE", e é o único outro terminal sem falha real.
      // Se isso confundir suporte/observabilidade no futuro (distinguir "usuário cancelou" de
      // "expirou por timeout"), considerar um status CANCELLED dedicado então.
      data: { status: 'EXPIRED' }
    });

    if (count !== 1) {
      return null;
    }

    return this.findById(jobId);
  }

  public async expireUploadPendingCreatedBefore(createdBefore: Date): Promise<number> {
    // O status no WHERE: se o complete já levou o job a QUEUED, ele não expira.
    const { count } = await prisma.video_jobs.updateMany({
      where: { status: 'UPLOAD_PENDING', created_at: { lt: createdBefore } },
      data: { status: 'EXPIRED' }
    });

    return count;
  }

  public async countProcessingNotUpdatedSince(updatedBefore: Date): Promise<number> {
    return prisma.video_jobs.count({
      where: { status: 'PROCESSING', updated_at: { lt: updatedBefore } }
    });
  }

  public async listByUser(userId: number, { limit, offset }: ListByUserPagination): Promise<ListByUserResult> {
    const [jobs, total] = await Promise.all([
      prisma.video_jobs.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.video_jobs.count({ where: { user_id: userId } })
    ]);

    return {
      items: jobs.map(job => this.toRecord(job)),
      total
    };
  }

  private toRecord(job: video_jobs): VideoJobRecord {
    return {
      id: job.id,
      userId: job.user_id,
      fileName: job.file_name,
      contentType: job.content_type,
      // BIGINT no banco; o limite de upload (500 MB) cabe com folga em number e bigint não serializa em JSON.
      fileSize: Number(job.file_size),
      status: job.status,
      failureReason: job.failure_reason,
      zipKey: job.zip_key,
      createdAt: job.created_at
    };
  }
}
