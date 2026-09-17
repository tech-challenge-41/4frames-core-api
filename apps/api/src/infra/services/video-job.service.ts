import { prisma, type video_jobs, type VideoJobStatus } from '@4frames/shared/prisma';

import {
  type CreateUploadPendingJobInput,
  type IVideoJobService,
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

  private toRecord(job: video_jobs): VideoJobRecord {
    return {
      id: job.id,
      userId: job.user_id,
      fileName: job.file_name,
      contentType: job.content_type,
      // BIGINT no banco; o limite de upload (500 MB) cabe com folga em number e bigint não serializa em JSON.
      fileSize: Number(job.file_size),
      status: job.status,
      failureReason: job.failure_reason
    };
  }
}
