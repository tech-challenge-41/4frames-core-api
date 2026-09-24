import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  type IVideoStorageService,
  type PresignedDownloadUrl,
  type PresignedUploadUrl
} from '@/domain/ports/service/video-storage.service.interface';

interface S3PresignedUrlServiceConfig {
  bucketName: string;
  /** Cliente das chamadas feitas pela própria API (HEAD, e futuramente GET/PUT). Usa o endpoint interno. */
  client: S3Client;
  /**
   * Cliente usado só para assinar URLs abertas pelo navegador. Usa o endpoint público.
   * Assinar não faz requisição, então este cliente nunca precisa alcançar o S3. Padrão: `client`.
   */
  presignClient?: S3Client;
}

export class S3PresignedUrlService implements IVideoStorageService {
  private readonly bucketName: string;
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor({ bucketName, client, presignClient }: S3PresignedUrlServiceConfig) {
    this.bucketName = bucketName;
    this.client = client;
    this.presignClient = presignClient ?? client;
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

    const uploadUrl = await getSignedUrl(this.presignClient, command, { expiresIn });

    return { uploadUrl, expiresIn };
  }

  public async generatePresignedDownloadUrl(key: string, expiresIn: number): Promise<PresignedDownloadUrl> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    const downloadUrl = await getSignedUrl(this.presignClient, command, { expiresIn });

    return { downloadUrl, expiresIn };
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
