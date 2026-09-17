import { createS3Client } from '@4frames/shared/aws';

import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { S3PresignedUrlService } from './s3-presigned-url.service';

export class S3PresignedUrlFactory {
  /**
   * AWS_ENDPOINT_URL é o endpoint que a API alcança (ex.: http://localstack:4566 dentro do Compose).
   * S3_PUBLIC_ENDPOINT_URL é o endpoint que o navegador alcança (ex.: http://localhost:4566) e só entra
   * na assinatura das URLs. Sem ele, as URLs são assinadas com o mesmo endpoint do SDK.
   */
  public static create(): IVideoStorageService {
    const bucketName = process.env.S3_BUCKET_NAME?.trim();

    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME is not set');
    }

    const client = createS3Client();
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT_URL?.trim();
    const presignClient = publicEndpoint ? createS3Client({ endpoint: publicEndpoint }) : client;

    return new S3PresignedUrlService({ bucketName, client, presignClient });
  }
}
