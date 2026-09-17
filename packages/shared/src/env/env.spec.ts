import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import {
  EnvValidationError,
  findEnvFile,
  loadEnv,
  parseEnv,
  redisEnvSchema,
  runtimeEnvSchema,
  s3EnvSchema,
  sqsEnvSchema
} from './index';

describe('env', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), '4frames-env-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function createMonorepo(withEnv: boolean): { root: string; packageDir: string } {
    const root = path.join(tmpRoot, 'repo');
    const packageDir = path.join(root, 'packages', 'shared', 'src');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages: ['packages/*']\n");

    if (withEnv) {
      fs.writeFileSync(path.join(root, '.env'), 'FOURFRAMES_TEST_VAR=from-file\nFOURFRAMES_TEST_KEEP=from-file\n');
    }

    return { root, packageDir };
  }

  describe('findEnvFile', () => {
    it('should find the .env at the monorepo root when starting from a nested package', () => {
      const { root, packageDir } = createMonorepo(true);

      expect(findEnvFile(packageDir)).toBe(path.join(root, '.env'));
    });

    it('should prefer the closest .env', () => {
      const { packageDir } = createMonorepo(true);
      const localEnv = path.join(packageDir, '.env');
      fs.writeFileSync(localEnv, 'A=1\n');

      expect(findEnvFile(packageDir)).toBe(localEnv);
    });

    it('should stop at the monorepo root and not use a .env from a parent folder', () => {
      const { packageDir } = createMonorepo(false);
      fs.writeFileSync(path.join(tmpRoot, '.env'), 'OUTSIDE=1\n');

      expect(findEnvFile(packageDir)).toBeUndefined();
    });
  });

  describe('loadEnv', () => {
    afterEach(() => {
      delete process.env.FOURFRAMES_TEST_VAR;
      delete process.env.FOURFRAMES_TEST_KEEP;
    });

    it('should load variables from the file without overriding variables already set', () => {
      const { root, packageDir } = createMonorepo(true);
      process.env.FOURFRAMES_TEST_KEEP = 'from-environment';

      const loaded = loadEnv({ startDir: packageDir });

      expect(loaded).toBe(path.join(root, '.env'));
      expect(process.env.FOURFRAMES_TEST_VAR).toBe('from-file');
      expect(process.env.FOURFRAMES_TEST_KEEP).toBe('from-environment');
    });

    it('should return undefined when there is no .env', () => {
      const { packageDir } = createMonorepo(false);

      expect(loadEnv({ startDir: packageDir })).toBeUndefined();
    });
  });

  describe('parseEnv', () => {
    it('should apply defaults and strip unknown variables', () => {
      const env = parseEnv(runtimeEnvSchema, { OTHER: 'x' });

      expect(env).toEqual({ NODE_ENV: 'development' });
    });

    it('should throw EnvValidationError listing every invalid variable', () => {
      const schema = z.object({ A: z.string(), B: z.coerce.number() });

      expect(() => parseEnv(schema, { B: 'abc' })).toThrow(EnvValidationError);

      try {
        parseEnv(schema, { B: 'abc' });
      } catch (error) {
        expect((error as EnvValidationError).issues).toHaveLength(2);
        expect((error as EnvValidationError).issues.join(' ')).toContain('A:');
      }
    });

    it('should validate the S3, SQS and Redis schemas', () => {
      expect(parseEnv(s3EnvSchema, { S3_BUCKET_NAME: 'bucket' })).toEqual({
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'bucket'
      });
      expect(() => parseEnv(sqsEnvSchema, { SQS_QUEUE_URL: 'not-a-url' })).toThrow(EnvValidationError);
      expect(parseEnv(redisEnvSchema, { REDIS_URL: 'redis://redis:6379' }).REDIS_URL).toBe('redis://redis:6379');
      expect(() => parseEnv(redisEnvSchema, { REDIS_URL: 'http://redis:6379' })).toThrow(EnvValidationError);
    });
  });
});
