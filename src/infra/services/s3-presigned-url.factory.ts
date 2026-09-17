import { S3Client } from '@aws-sdk/client-s3';

import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { S3PresignedUrlService } from './s3-presigned-url.service';

export class S3PresignedUrlFactory {
  public static create(): IVideoStorageService {
    const bucketName = process.env.S3_BUCKET_NAME?.trim();

    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME is not set');
    }

    const client = new S3Client({
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_ENDPOINT_URL,
      forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
      requestChecksumCalculation: 'WHEN_REQUIRED'
    });

    return new S3PresignedUrlService({ bucketName, client });
  }
}
