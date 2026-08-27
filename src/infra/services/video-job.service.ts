import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';
import { prisma } from '@/infra/db/core/prisma/client';

export class VideoJobService implements IVideoJobService {
  public async createUploadPendingJob(userId: number, fileName: string): Promise<VideoJobRecord> {
    const job = await prisma.video_jobs.create({
      data: {
        user_id: userId,
        file_name: fileName,
        status: 'UPLOAD_PENDING'
      }
    });

    return {
      id: job.id,
      userId: job.user_id,
      fileName: job.file_name,
      status: job.status
    };
  }
}
