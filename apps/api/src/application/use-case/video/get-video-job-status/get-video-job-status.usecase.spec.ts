import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';

import { GetVideoJobStatusUseCase } from './get-video-job-status.usecase';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
const MISSING_JOB_ID = '00000000-0000-4000-8000-000000000000';

function buildJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
  return {
    id: JOB_ID,
    userId: 1,
    fileName: 'my-video.mp4',
    contentType: 'video/mp4',
    fileSize: 1024,
    status: 'PROCESSING',
    failureReason: null,
    zipKey: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('GetVideoJobStatusUseCase', () => {
  let useCase: GetVideoJobStatusUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      listByUser: jest.fn(),
      cancelIfPending: jest.fn()
    };

    useCase = new GetVideoJobStatusUseCase({ videoJobService });
  });

  it('should return the job status when the job belongs to the user', async () => {
    videoJobService.findById.mockResolvedValue(buildJob());

    const result = await useCase.execute({ userId: 1, jobId: JOB_ID });

    expect(videoJobService.findById).toHaveBeenCalledWith(JOB_ID);
    expect(result).toEqual({
      jobId: JOB_ID,
      status: 'PROCESSING',
      fileName: 'my-video.mp4'
    });
  });

  it('should include the failure reason when the job failed', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ status: 'FAILED', failureReason: 'Invalid video file' }));

    const result = await useCase.execute({ userId: 1, jobId: JOB_ID });

    expect(result).toEqual({
      jobId: JOB_ID,
      status: 'FAILED',
      fileName: 'my-video.mp4',
      failureReason: 'Invalid video file'
    });
  });

  it('should throw NOT_FOUND DomainError when the job does not exist', async () => {
    videoJobService.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: MISSING_JOB_ID })).rejects.toThrow(DomainError);
    await expect(useCase.execute({ userId: 1, jobId: MISSING_JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
  });

  it('should throw NOT_FOUND DomainError when the job belongs to another user', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ userId: 2, status: 'DONE' }));

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toThrow(DomainError);
    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
  });
});
