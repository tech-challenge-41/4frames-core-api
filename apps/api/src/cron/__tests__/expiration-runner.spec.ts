import { type ExpireAbandonedUploadsOutputDTO } from '@/application/use-case/video/expire-abandoned-uploads/expire-abandoned-uploads.dto';
import { type ILogger } from '@/domain/ports/service/logger.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { ExpirationRunner } from '../expiration-runner';

const RESULT: ExpireAbandonedUploadsOutputDTO = {
  expired: 2,
  createdBefore: new Date('2026-09-27T11:54:00.000Z'),
  stuckProcessing: 1
};

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

describe('ExpirationRunner', () => {
  let useCase: jest.Mocked<IUseCase<void, ExpireAbandonedUploadsOutputDTO>>;
  let logger: jest.Mocked<ILogger>;
  let runner: ExpirationRunner;

  beforeEach(() => {
    jest.useFakeTimers();
    useCase = { execute: jest.fn().mockResolvedValue(RESULT) };
    logger = createLogger();
    runner = new ExpirationRunner({ useCase, logger, intervalMs: 1_000 });
  });

  afterEach(async () => {
    await runner.stop();
    jest.useRealTimers();
  });

  it('runOnce should run one pass and report it', async () => {
    await expect(runner.runOnce()).resolves.toBe(RESULT);

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Expiration pass finished', { expired: 2, stuckProcessing: 1 });
  });

  it('runOnce should propagate a failure, so the --once process exits with an error', async () => {
    useCase.execute.mockRejectedValue(new Error('connection refused'));

    await expect(runner.runOnce()).rejects.toThrow('connection refused');
  });

  it('start should run a pass right away and then one per interval', async () => {
    runner.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(useCase.execute).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(useCase.execute).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(2_000);
    expect(useCase.execute).toHaveBeenCalledTimes(4);
  });

  it('should keep the loop going after a failed pass', async () => {
    useCase.execute.mockRejectedValueOnce(new Error('connection refused'));

    runner.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith('Expiration pass failed', expect.any(Error));

    await jest.advanceTimersByTimeAsync(1_000);
    expect(useCase.execute).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('Expiration pass finished', { expired: 2, stuckProcessing: 1 });
  });

  it('should not start a pass while the previous one is still running', async () => {
    let finish: (value: ExpireAbandonedUploadsOutputDTO) => void = () => undefined;
    useCase.execute.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));

    runner.start();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(useCase.execute).toHaveBeenCalledTimes(1);

    finish(RESULT);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(useCase.execute).toHaveBeenCalledTimes(2);
  });

  it('stop should end the loop after the pass in progress finishes', async () => {
    let finish: (value: ExpireAbandonedUploadsOutputDTO) => void = () => undefined;
    useCase.execute.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));

    runner.start();
    await jest.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = runner.stop().then(() => (stopped = true));
    await jest.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish(RESULT);
    await stopping;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(useCase.execute).toHaveBeenCalledTimes(1);
  });

  it('start should be idempotent', async () => {
    runner.start();
    runner.start();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(useCase.execute).toHaveBeenCalledTimes(2);
  });
});
