import { EnvValidationError } from '@4frames/shared/env';

import { DEFAULT_UPLOAD_URL_TTL_SECONDS, readUploadUrlTtlSeconds } from '../upload.config';

describe('readUploadUrlTtlSeconds', () => {
  it('should default to 5 minutes', () => {
    expect(readUploadUrlTtlSeconds({})).toBe(DEFAULT_UPLOAD_URL_TTL_SECONDS);
    expect(DEFAULT_UPLOAD_URL_TTL_SECONDS).toBe(300);
  });

  it('should read UPLOAD_URL_TTL_SECONDS', () => {
    expect(readUploadUrlTtlSeconds({ UPLOAD_URL_TTL_SECONDS: '900' })).toBe(900);
  });

  it.each(['0', '-5', '1.5', 'abc'])('should reject an invalid value (%s)', value => {
    expect(() => readUploadUrlTtlSeconds({ UPLOAD_URL_TTL_SECONDS: value })).toThrow(EnvValidationError);
  });
});
