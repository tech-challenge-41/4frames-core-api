import { HeadObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  type IVideoStorageService,
  type PresignedUploadUrl
} from '@/domain/ports/service/video-storage.service.interface';

interface S3PresignedUrlServiceConfig {
  bucketName: string;
  client: S3Client;
}

export class S3PresignedUrlService implements IVideoStorageService {
  private readonly bucketName: string;
  private readonly client: S3Client;

  constructor({ bucketName, client }: S3PresignedUrlServiceConfig) {
    this.bucketName = bucketName;
    this.client = client;
  }

  public async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number
  ): Promise<PresignedUploadUrl> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });

    return { uploadUrl, expiresIn };
  }

  public async headObject(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound')
      ) {
        return false;
      }

      throw error;
    }
  }
}
