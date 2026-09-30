import { type Logger } from '@4frames/shared/logger';

import { type NotifyVideoJobTerminalUseCase } from '@/application/notify-video-job-terminal.usecase';
import { type NotifyJobContext, type PrismaVideoJobNotifierRepository } from '@/repo/video-job-notifier.repository';

import { UnnotifiedJobsRecovery } from './unnotified-jobs-recovery';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_JOB_ID = '22222222-2222-4222-8222-222222222222';
const INTERVAL_MS = 60_000;

function createFakeLogger(): jest.Mocked<Logger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);

  return logger;
}

function buildContext(jobId: string): NotifyJobContext {
  return {
    jobId,
    userId: 1,
    userEmail: 'user@user.com',
    fileName: 'clip.mp4',
    status: 'DONE',
    failureReason: null,
    frameCount: 30,
    notifiedAt: null
  };
}

describe('UnnotifiedJobsRecovery', () => {
  const repository: jest.Mocked<Pick<PrismaVideoJobNotifierRepository, 'listUnnotifiedTerminal'>> = {
    listUnnotifiedTerminal: jest.fn()
  };
  const useCase: jest.Mocked<Pick<NotifyVideoJobTerminalUseCase, 'fromRecovery'>> = {
    fromRecovery: jest.fn()
  };

  let logger: jest.Mocked<Logger>;
  let recovery: UnnotifiedJobsRecovery;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    logger = createFakeLogger();
    repository.listUnnotifiedTerminal.mockResolvedValue([]);
    useCase.fromRecovery.mockResolvedValue(undefined);
    recovery = new UnnotifiedJobsRecovery({
      repository: repository as unknown as PrismaVideoJobNotifierRepository,
      useCase: useCase as unknown as NotifyVideoJobTerminalUseCase,
      logger,
      intervalMs: INTERVAL_MS,
      batchSize: 50
    });
  });

  afterEach(() => {
    recovery.stop();
    jest.useRealTimers();
  });

  it('should sweep right away on start, notifying every job the repository returns', async () => {
    repository.listUnnotifiedTerminal.mockResolvedValue([buildContext(JOB_ID), buildContext(OTHER_JOB_ID)]);

    recovery.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(repository.listUnnotifiedTerminal).toHaveBeenCalledWith(50);
    expect(useCase.fromRecovery).toHaveBeenNthCalledWith(1, JOB_ID);
    expect(useCase.fromRecovery).toHaveBeenNthCalledWith(2, OTHER_JOB_ID);
  });

  it('should sweep again on every interval', async () => {
    recovery.start();
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(repository.listUnnotifiedTerminal).toHaveBeenCalledTimes(3);
  });

  it('should keep notifying the other jobs when one of them fails', async () => {
    repository.listUnnotifiedTerminal.mockResolvedValue([buildContext(JOB_ID), buildContext(OTHER_JOB_ID)]);
    useCase.fromRecovery.mockRejectedValueOnce(new Error('SMTP down'));

    recovery.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(useCase.fromRecovery).toHaveBeenCalledWith(OTHER_JOB_ID);
    expect(logger.error).toHaveBeenCalledWith('Recovery notification failed', expect.any(Error), {
      jobId: JOB_ID,
      errorMessage: 'SMTP down'
    });
  });

  it('should log a failed sweep and try again on the next interval', async () => {
    repository.listUnnotifiedTerminal.mockRejectedValueOnce(new Error('database unavailable'));

    recovery.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(useCase.fromRecovery).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Recovery sweep failed', expect.any(Error), {
      errorMessage: 'database unavailable'
    });

    repository.listUnnotifiedTerminal.mockResolvedValue([buildContext(JOB_ID)]);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(useCase.fromRecovery).toHaveBeenCalledWith(JOB_ID);
  });

  it('should log non-Error rejections by their string value', async () => {
    repository.listUnnotifiedTerminal.mockResolvedValue([buildContext(JOB_ID)]);
    useCase.fromRecovery.mockRejectedValueOnce('boom');

    recovery.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith('Recovery notification failed', undefined, {
      jobId: JOB_ID,
      errorMessage: 'boom'
    });
  });

  it('should stop sweeping after stop', async () => {
    recovery.start();
    await jest.advanceTimersByTimeAsync(0);

    recovery.stop();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(repository.listUnnotifiedTerminal).toHaveBeenCalledTimes(1);
  });

  it('should be safe to stop before starting', () => {
    expect(() => recovery.stop()).not.toThrow();
  });
});
