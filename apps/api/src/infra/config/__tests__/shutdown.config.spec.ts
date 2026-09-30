import { EnvValidationError } from '@4frames/shared/env';

import { DEFAULT_API_SHUTDOWN_TIMEOUT_SECONDS, readShutdownTimeouts } from '../shutdown.config';

describe('readShutdownTimeouts', () => {
  it('should default to 20 s, keeping 5 s to close Prisma and Redis', () => {
    expect(DEFAULT_API_SHUTDOWN_TIMEOUT_SECONDS).toBe(20);
    expect(readShutdownTimeouts({})).toEqual({ shutdownTimeoutMs: 20_000, drainTimeoutMs: 15_000 });
  });

  it('should read API_SHUTDOWN_TIMEOUT_SECONDS', () => {
    expect(readShutdownTimeouts({ API_SHUTDOWN_TIMEOUT_SECONDS: '60' })).toEqual({
      shutdownTimeoutMs: 60_000,
      drainTimeoutMs: 55_000
    });
  });

  it('should keep a quarter of a short timeout for closing resources', () => {
    expect(readShutdownTimeouts({ API_SHUTDOWN_TIMEOUT_SECONDS: '4' })).toEqual({
      shutdownTimeoutMs: 4_000,
      drainTimeoutMs: 3_000
    });
  });

  it.each(['0', '-5', '1.5', 'abc'])('should reject an invalid value (%s)', value => {
    expect(() => readShutdownTimeouts({ API_SHUTDOWN_TIMEOUT_SECONDS: value })).toThrow(EnvValidationError);
  });
});
