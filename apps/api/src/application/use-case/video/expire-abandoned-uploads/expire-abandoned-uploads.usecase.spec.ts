import { type ILogger } from '@/domain/ports/service/logger.interface';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';

import {
  EXPIRATION_MARGIN_SECONDS,
  ExpireAbandonedUploadsUseCase,
  STUCK_PROCESSING_AFTER_MS
} from './expire-abandoned-uploads.usecase';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const UPLOAD_URL_TTL_SECONDS = 300;

function createLogger(): jest.Mocked<ILogger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

describe('ExpireAbandonedUploadsUseCase', () => {
  let videoJobService: jest.Mocked<IVideoJobService>;
  let logger: jest.Mocked<ILogger>;
  let useCase: ExpireAbandonedUploadsUseCase;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      listByUser: jest.fn(),
      cancelIfPending: jest.fn(),
      expireUploadPendingCreatedBefore: jest.fn().mockResolvedValue(0),
      countProcessingNotUpdatedSince: jest.fn().mockResolvedValue(0)
    };
    logger = createLogger();
    useCase = new ExpireAbandonedUploadsUseCase({
      videoJobService,
      logger,
      uploadUrlExpiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      now: () => NOW
    });
  });

  it('should expire UPLOAD_PENDING jobs older than the upload URL validity plus the margin', async () => {
    videoJobService.expireUploadPendingCreatedBefore.mockResolvedValue(3);

    const result = await useCase.execute();

    const expectedCutoff = new Date(NOW.getTime() - (UPLOAD_URL_TTL_SECONDS + EXPIRATION_MARGIN_SECONDS) * 1000);
    expect(expectedCutoff.toISOString()).toBe('2026-09-27T11:54:00.000Z');
    expect(videoJobService.expireUploadPendingCreatedBefore).toHaveBeenCalledWith(expectedCutoff);
    expect(result).toEqual({ expired: 3, createdBefore: expectedCutoff, stuckProcessing: 0 });
    expect(logger.info).toHaveBeenCalledWith('Abandoned uploads expired', {
      expired: 3,
      createdBefore: '2026-09-27T11:54:00.000Z'
    });
  });

  it('should count PROCESSING jobs without updates for 15 minutes and warn about them', async () => {
    videoJobService.countProcessingNotUpdatedSince.mockResolvedValue(2);

    const result = await useCase.execute();

    const expectedCutoff = new Date(NOW.getTime() - STUCK_PROCESSING_AFTER_MS);
    expect(videoJobService.countProcessingNotUpdatedSince).toHaveBeenCalledWith(expectedCutoff);
    expect(result.stuckProcessing).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith('Jobs in PROCESSING without updates', {
      stuckProcessing: 2,
      notUpdatedSince: '2026-09-27T11:45:00.000Z'
    });
  });

  it('should stay quiet when there is nothing to expire or to warn about', async () => {
    await expect(useCase.execute()).resolves.toMatchObject({ expired: 0, stuckProcessing: 0 });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should let a database failure propagate, so the run is reported as failed', async () => {
    videoJobService.expireUploadPendingCreatedBefore.mockRejectedValue(new Error('connection refused'));

    await expect(useCase.execute()).rejects.toThrow('connection refused');
  });

  it('should use the current time by default', async () => {
    const defaultClock = new ExpireAbandonedUploadsUseCase({
      videoJobService,
      logger,
      uploadUrlExpiresInSeconds: UPLOAD_URL_TTL_SECONDS
    });
    const before = Date.now();

    const { createdBefore } = await defaultClock.execute();

    const margin = (UPLOAD_URL_TTL_SECONDS + EXPIRATION_MARGIN_SECONDS) * 1000;
    expect(createdBefore.getTime()).toBeGreaterThanOrEqual(before - margin);
    expect(createdBefore.getTime()).toBeLessThanOrEqual(Date.now() - margin);
  });
});
