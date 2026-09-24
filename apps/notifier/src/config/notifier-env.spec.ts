import { EnvValidationError, parseEnv } from '@4frames/shared/env';

import { notifierEnvSchema, readNotifierEnv } from './notifier-env';

const BASE = {
  REDIS_URL: 'redis://localhost:6379',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: '4Frames <no-reply@test.local>',
  WEB_APP_URL: 'http://localhost:5173'
};

describe('notifierEnvSchema', () => {
  it('should apply defaults for recovery settings', () => {
    expect(parseEnv(notifierEnvSchema, BASE)).toMatchObject({
      NOTIFIER_RECOVERY_INTERVAL_SECONDS: 120,
      NOTIFIER_RECOVERY_BATCH_SIZE: 20
    });
  });

  it('should reject missing WEB_APP_URL', () => {
    expect(() => parseEnv(notifierEnvSchema, { ...BASE, WEB_APP_URL: undefined })).toThrow(EnvValidationError);
  });

  it('should read SMTP_PASSWORD when SMTP_PASS is unset', () => {
    expect(
      readNotifierEnv({
        ...BASE,
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'secret'
      }).SMTP_PASS
    ).toBe('secret');
  });
});
