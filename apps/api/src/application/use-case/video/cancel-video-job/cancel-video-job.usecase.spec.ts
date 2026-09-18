import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';

import { CancelVideoJobUseCase } from './cancel-video-job.usecase';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
const MISSING_JOB_ID = '00000000-0000-4000-8000-000000000000';

function buildJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
  return {
    id: JOB_ID,
    userId: 1,
    fileName: 'my-video.mp4',
    contentType: 'video/mp4',
    fileSize: 1024,
    status: 'UPLOAD_PENDING',
    failureReason: null,
    zipKey: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('CancelVideoJobUseCase', () => {
  let useCase: CancelVideoJobUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      listByUser: jest.fn(),
      cancelIfPending: jest.fn()
    };

    useCase = new CancelVideoJobUseCase({ videoJobService });
  });

  it('should cancel a job in UPLOAD_PENDING', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ status: 'UPLOAD_PENDING' }));
    videoJobService.cancelIfPending.mockResolvedValue(buildJob({ status: 'EXPIRED' }));

    const result = await useCase.execute({ userId: 1, jobId: JOB_ID });

    expect(videoJobService.cancelIfPending).toHaveBeenCalledWith(JOB_ID, 1);
    expect(result).toEqual({ jobId: JOB_ID, status: 'EXPIRED' });
  });

  it('should cancel a job in QUEUED', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ status: 'QUEUED' }));
    videoJobService.cancelIfPending.mockResolvedValue(buildJob({ status: 'EXPIRED' }));

    const result = await useCase.execute({ userId: 1, jobId: JOB_ID });

    expect(result).toEqual({ jobId: JOB_ID, status: 'EXPIRED' });
  });

  it('should throw NOT_FOUND DomainError when the job does not exist', async () => {
    videoJobService.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: MISSING_JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoJobService.cancelIfPending).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND DomainError when the job belongs to another user', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ userId: 2 }));

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoJobService.cancelIfPending).not.toHaveBeenCalled();
  });

  it.each(['PROCESSING', 'DONE', 'FAILED', 'EXPIRED'])(
    'should throw INVALID_STATE DomainError when the job is already %s',
    async status => {
      videoJobService.findById.mockResolvedValue(buildJob({ status }));

      await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toBeInstanceOf(DomainError);
      await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
        type: DomainErrorTypes.INVALID_STATE
      });
      expect(videoJobService.cancelIfPending).not.toHaveBeenCalled();
    }
  );

  it('should throw INVALID_STATE DomainError when the worker wins the race for a QUEUED job', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ status: 'QUEUED' }));
    // O worker chamou markProcessing entre o findById e o cancelIfPending: a escrita condicional não bate.
    videoJobService.cancelIfPending.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.INVALID_STATE
    });
  });
});
