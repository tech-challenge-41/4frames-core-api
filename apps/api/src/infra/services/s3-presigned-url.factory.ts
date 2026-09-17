import { createS3Client } from '@4frames/shared/aws';

import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { S3PresignedUrlService } from './s3-presigned-url.service';

export class S3PresignedUrlFactory {
  public static create(): IVideoStorageService {
    const bucketName = process.env.S3_BUCKET_NAME?.trim();

    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME is not set');
    }

    return new S3PresignedUrlService({ bucketName, client: createS3Client() });
  }
}
