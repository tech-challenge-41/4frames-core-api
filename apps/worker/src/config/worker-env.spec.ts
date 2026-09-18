import os from 'node:os';
import path from 'node:path';

import { EnvValidationError, parseEnv } from '@4frames/shared/env';

import { workerEnvSchema } from './worker-env';

const REQUIRED = {
  S3_BUCKET_NAME: '4frames-videos',
  SQS_QUEUE_URL: 'http://localstack:4566/000000000000/4frames-video-uploads',
  REDIS_URL: 'redis://redis:6379'
};

describe('workerEnvSchema', () => {
  it('should apply the base project defaults (1 fps, PNG) and the worker defaults', () => {
    expect(parseEnv(workerEnvSchema, REQUIRED)).toEqual({
      ...REQUIRED,
      NODE_ENV: 'development',
      AWS_REGION: 'us-east-1',
      VISIBILITY_TIMEOUT_SECONDS: 600,
      FRAME_FPS: 1,
      FRAME_FORMAT: 'png',
      MAX_VIDEO_DURATION_SECONDS: 600,
      WORKER_TMP_DIR: path.join(os.tmpdir(), '4frames'),
      WORKER_HEALTH_PORT: 9100,
      WORKER_SHUTDOWN_TIMEOUT_SECONDS: 570,
      FFMPEG_TIMEOUT_SECONDS: 1800
    });
  });

  it('should coerce numbers from the environment', () => {
    const env = parseEnv(workerEnvSchema, {
      ...REQUIRED,
      SQS_DLQ_URL: 'http://localstack:4566/000000000000/4frames-video-uploads-dlq',
      VISIBILITY_TIMEOUT_SECONDS: '60',
      FRAME_FPS: '0.5',
      FRAME_FORMAT: 'jpg',
      WORKER_TMP_DIR: '/tmp/4frames'
    });

    expect(env).toMatchObject({
      VISIBILITY_TIMEOUT_SECONDS: 60,
      FRAME_FPS: 0.5,
      FRAME_FORMAT: 'jpg',
      WORKER_TMP_DIR: '/tmp/4frames'
    });
  });

  it('should fall back to the system temporary directory when WORKER_TMP_DIR is empty', () => {
    expect(parseEnv(workerEnvSchema, { ...REQUIRED, WORKER_TMP_DIR: '' }).WORKER_TMP_DIR).toBe(
      path.join(os.tmpdir(), '4frames')
    );
  });

  it.each([
    [{ SQS_QUEUE_URL: undefined }],
    [{ REDIS_URL: 'http://redis:6379' }],
    [{ FRAME_FORMAT: 'gif' }],
    [{ FRAME_FPS: '0' }],
    [{ VISIBILITY_TIMEOUT_SECONDS: '10' }],
    [{ WORKER_HEALTH_PORT: 'abc' }]
  ])('should reject an invalid configuration %p', overrides => {
    expect(() => parseEnv(workerEnvSchema, { ...REQUIRED, ...overrides })).toThrow(EnvValidationError);
  });
});
