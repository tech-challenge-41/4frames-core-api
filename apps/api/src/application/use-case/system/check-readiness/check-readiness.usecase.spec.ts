import { type IDependencyHealthIndicator } from '@/domain/ports/service/dependency-health.service.interface';
import { type ILogger } from '@/domain/ports/service/logger.interface';

import { CheckReadinessUseCase, DEFAULT_DEPENDENCY_CHECK_TIMEOUT_MS } from './check-readiness.usecase';

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

function indicator(name: string, check: () => Promise<void>): IDependencyHealthIndicator {
  return { name, check: jest.fn(check) };
}

describe('CheckReadinessUseCase', () => {
  let logger: jest.Mocked<ILogger>;

  beforeEach(() => {
    logger = createLogger();
  });

  it('should be ready when every dependency responds', async () => {
    const useCase = new CheckReadinessUseCase({
      indicators: [indicator('database', async () => undefined), indicator('redis', async () => undefined)],
      logger
    });

    await expect(useCase.execute()).resolves.toEqual({ ready: true, checks: { database: 'up', redis: 'up' } });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should not be ready when one dependency fails, reporting which one', async () => {
    const useCase = new CheckReadinessUseCase({
      indicators: [
        indicator('database', async () => {
          throw new Error('connection refused');
        }),
        indicator('redis', async () => undefined)
      ],
      logger
    });

    await expect(useCase.execute()).resolves.toEqual({ ready: false, checks: { database: 'down', redis: 'up' } });
    expect(logger.warn).toHaveBeenCalledWith('Readiness check failed', {
      dependency: 'database',
      error: 'connection refused'
    });
  });

  it('should mark a dependency that does not answer in time as down', async () => {
    jest.useFakeTimers();

    try {
      const useCase = new CheckReadinessUseCase({
        indicators: [indicator('database', () => new Promise<void>(() => undefined))],
        logger
      });

      const result = useCase.execute();
      await jest.advanceTimersByTimeAsync(DEFAULT_DEPENDENCY_CHECK_TIMEOUT_MS);

      await expect(result).resolves.toEqual({ ready: false, checks: { database: 'down' } });
      expect(logger.warn).toHaveBeenCalledWith('Readiness check failed', {
        dependency: 'database',
        error: `No response after ${DEFAULT_DEPENDENCY_CHECK_TIMEOUT_MS}ms`
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('should check the dependencies in parallel', async () => {
    const started: string[] = [];
    let releaseDatabase: () => void = () => undefined;
    const useCase = new CheckReadinessUseCase({
      indicators: [
        indicator('database', () => {
          started.push('database');
          return new Promise<void>(resolve => {
            releaseDatabase = resolve;
          });
        }),
        indicator('redis', async () => {
          started.push('redis');
        })
      ],
      logger
    });

    const result = useCase.execute();
    await Promise.resolve();

    expect(started).toEqual(['database', 'redis']);
    releaseDatabase();
    await expect(result).resolves.toMatchObject({ ready: true });
  });

  it('should log a non-Error rejection as text', async () => {
    const useCase = new CheckReadinessUseCase({
      indicators: [indicator('redis', () => Promise.reject('NOAUTH'))],
      logger,
      timeoutMs: 50
    });

    await expect(useCase.execute()).resolves.toEqual({ ready: false, checks: { redis: 'down' } });
    expect(logger.warn).toHaveBeenCalledWith('Readiness check failed', { dependency: 'redis', error: 'NOAUTH' });
  });
});
