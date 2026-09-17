import { HeadObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

import { S3PresignedUrlService } from '../s3-presigned-url.service';

const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };

function createClient(endpoint: string): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials,
    requestChecksumCalculation: 'WHEN_REQUIRED'
  });
}

function notFound(): S3ServiceException {
  return new S3ServiceException({ name: 'NotFound', $fault: 'client', $metadata: { httpStatusCode: 404 } });
}

describe('S3PresignedUrlService', () => {
  const key = 'videos/1/6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10/source.mp4';
  let internalClient: S3Client;
  let publicClient: S3Client;

  beforeEach(() => {
    internalClient = createClient('http://localstack:4566');
    publicClient = createClient('http://localhost:4566');
  });

  it('should sign upload URLs with the public endpoint, not the internal one', async () => {
    const service = new S3PresignedUrlService({
      bucketName: '4frames-videos',
      client: internalClient,
      presignClient: publicClient
    });

    const { uploadUrl, expiresIn } = await service.generatePresignedUploadUrl(key, 'video/mp4', 120);
    const url = new URL(uploadUrl);

    expect(url.origin).toBe('http://localhost:4566');
    expect(url.pathname).toBe(`/4frames-videos/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(expiresIn).toBe(120);
  });

  it('should sign with the SDK client when no public client is given', async () => {
    const service = new S3PresignedUrlService({ bucketName: '4frames-videos', client: internalClient });

    const { uploadUrl } = await service.generatePresignedUploadUrl(key, 'video/mp4', 300);

    expect(new URL(uploadUrl).origin).toBe('http://localstack:4566');
  });

  it('should check the object through the internal client', async () => {
    const internalSend = jest.spyOn(internalClient, 'send').mockResolvedValue({} as never);
    const publicSend = jest.spyOn(publicClient, 'send');
    const service = new S3PresignedUrlService({
      bucketName: '4frames-videos',
      client: internalClient,
      presignClient: publicClient
    });

    await expect(service.headObject(key)).resolves.toBe(true);

    expect(internalSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    expect(publicSend).not.toHaveBeenCalled();
  });

  it('should return false when the object does not exist', async () => {
    jest.spyOn(internalClient, 'send').mockRejectedValue(notFound() as never);
    const service = new S3PresignedUrlService({ bucketName: '4frames-videos', client: internalClient });

    await expect(service.headObject(key)).resolves.toBe(false);
  });

  it('should rethrow other storage errors', async () => {
    jest.spyOn(internalClient, 'send').mockRejectedValue(new Error('connection refused') as never);
    const service = new S3PresignedUrlService({ bucketName: '4frames-videos', client: internalClient });

    await expect(service.headObject(key)).rejects.toThrow('connection refused');
  });
});
