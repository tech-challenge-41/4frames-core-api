import { S3PresignedUrlFactory } from '../s3-presigned-url.factory';

describe('S3PresignedUrlFactory', () => {
  const originalEnv = { ...process.env };
  const key = 'videos/1/6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10/source.mp4';

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      S3_BUCKET_NAME: '4frames-videos',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test'
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should sign URLs for the browser with S3_PUBLIC_ENDPOINT_URL when the SDK uses the internal host', async () => {
    process.env.AWS_ENDPOINT_URL = 'http://localstack:4566';
    process.env.S3_PUBLIC_ENDPOINT_URL = 'http://localhost:4566';

    const { uploadUrl } = await S3PresignedUrlFactory.create().generatePresignedUploadUrl(key, 'video/mp4', 300);

    expect(uploadUrl.startsWith(`http://localhost:4566/4frames-videos/${key}?`)).toBe(true);
  });

  it('should fall back to AWS_ENDPOINT_URL when S3_PUBLIC_ENDPOINT_URL is not set', async () => {
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    delete process.env.S3_PUBLIC_ENDPOINT_URL;

    const { uploadUrl } = await S3PresignedUrlFactory.create().generatePresignedUploadUrl(key, 'video/mp4', 300);

    expect(uploadUrl.startsWith(`http://localhost:4566/4frames-videos/${key}?`)).toBe(true);
  });

  it('should fail fast without S3_BUCKET_NAME', () => {
    delete process.env.S3_BUCKET_NAME;

    expect(() => S3PresignedUrlFactory.create()).toThrow('S3_BUCKET_NAME is not set');
  });
});
