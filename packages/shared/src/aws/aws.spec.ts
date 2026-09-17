import { createS3Client, createSqsClient, resolveAwsClientOptions } from './index';

describe('aws clients', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('resolveAwsClientOptions', () => {
    it('should read region and endpoint from the environment', () => {
      expect(
        resolveAwsClientOptions({}, { AWS_REGION: 'sa-east-1', AWS_ENDPOINT_URL: 'http://localstack:4566' })
      ).toEqual({
        region: 'sa-east-1',
        endpoint: 'http://localstack:4566'
      });
    });

    it('should prefer explicit options and default the region', () => {
      expect(
        resolveAwsClientOptions({ endpoint: 'http://localhost:4566' }, { AWS_ENDPOINT_URL: 'http://x:1' })
      ).toEqual({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566'
      });
    });

    it('should omit an empty endpoint so the real AWS endpoint is used', () => {
      expect(resolveAwsClientOptions({}, { AWS_ENDPOINT_URL: '  ' })).toEqual({ region: 'us-east-1' });
    });
  });

  describe('createS3Client', () => {
    it('should use path-style and checksum only when required for a custom endpoint', async () => {
      const client = createS3Client({ endpoint: 'http://localhost:4566', region: 'us-east-1' });

      expect(client.config.forcePathStyle).toBe(true);
      expect(await client.config.region()).toBe('us-east-1');
      expect(await client.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
      expect(await client.config.endpoint?.()).toMatchObject({ hostname: 'localhost', port: 4566, protocol: 'http:' });
    });

    it('should not force path-style without a custom endpoint', () => {
      delete process.env.AWS_ENDPOINT_URL;

      expect(createS3Client({ region: 'us-east-1' }).config.forcePathStyle).toBe(false);
    });
  });

  describe('createSqsClient', () => {
    it('should point to the configured endpoint', async () => {
      const client = createSqsClient({ endpoint: 'http://localstack:4566', region: 'us-east-1' });

      expect(await client.config.region()).toBe('us-east-1');
      expect(await client.config.endpoint?.()).toMatchObject({ hostname: 'localstack', port: 4566 });
    });
  });
});
