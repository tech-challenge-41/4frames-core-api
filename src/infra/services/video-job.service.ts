import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';
import { prisma } from '@/infra/db/core/prisma/client';
import { type VideoJobStatus } from '@/infra/db/core/prisma/generated/enums';

export class VideoJobService implements IVideoJobService {
  public async createUploadPendingJob(userId: number, fileName: string, contentType: string): Promise<VideoJobRecord> {
    const job = await prisma.video_jobs.create({
      data: {
        user_id: userId,
        file_name: fileName,
        content_type: contentType,
        status: 'UPLOAD_PENDING'
      }
    });

    return this.toRecord(job);
  }

  public async findById(jobId: number): Promise<VideoJobRecord | null> {
    const job = await prisma.video_jobs.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return null;
    }

    return this.toRecord(job);
  }

  public async updateStatus(jobId: number, status: string): Promise<VideoJobRecord> {
    const job = await prisma.video_jobs.update({
      where: { id: jobId },
      data: { status: status as VideoJobStatus }
    });

    return this.toRecord(job);
  }

  private toRecord(job: {
    id: number;
    user_id: number;
    file_name: string;
    content_type: string;
    status: string;
  }): VideoJobRecord {
    return {
      id: job.id,
      userId: job.user_id,
      fileName: job.file_name,
      contentType: job.content_type,
      status: job.status
    };
  }
}
