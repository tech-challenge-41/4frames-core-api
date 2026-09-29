import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { CompleteVideoJobUseCase } from './complete-video-job.usecase';

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

describe('CompleteVideoJobUseCase', () => {
  let useCase: CompleteVideoJobUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;
  let videoStorageService: jest.Mocked<IVideoStorageService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      queueIfUploadPending: jest.fn(),
      listByUser: jest.fn(),
      cancelIfPending: jest.fn(),
      expireUploadPendingCreatedBefore: jest.fn(),
      countProcessingNotUpdatedSince: jest.fn()
    };

    videoStorageService = {
      generatePresignedUploadUrl: jest.fn(),
      generatePresignedDownloadUrl: jest.fn(),
      headObject: jest.fn()
    };

    useCase = new CompleteVideoJobUseCase({ videoJobService, videoStorageService });
  });

  it('should confirm the upload and move the job from UPLOAD_PENDING to QUEUED', async () => {
    videoJobService.findById.mockResolvedValue(buildJob());
    videoStorageService.headObject.mockResolvedValue(true);
    videoJobService.queueIfUploadPending.mockResolvedValue(buildJob({ status: 'QUEUED' }));

    const result = await useCase.execute({ userId: 1, jobId: JOB_ID });

    expect(videoStorageService.headObject).toHaveBeenCalledWith(`videos/1/${JOB_ID}/source.mp4`);
    expect(videoJobService.queueIfUploadPending).toHaveBeenCalledWith(JOB_ID, 1);
    expect(result).toEqual({
      jobId: JOB_ID,
      status: 'QUEUED',
      fileName: 'my-video.mp4'
    });
  });

  it('should throw NOT_FOUND DomainError when the job does not exist', async () => {
    videoJobService.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: MISSING_JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoStorageService.headObject).not.toHaveBeenCalled();
    expect(videoJobService.queueIfUploadPending).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND DomainError when the job belongs to another user', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ userId: 2 }));

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoStorageService.headObject).not.toHaveBeenCalled();
  });

  it('should throw INVALID_STATE DomainError when the job is not UPLOAD_PENDING', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ status: 'QUEUED' }));

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toBeInstanceOf(DomainError);
    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.INVALID_STATE
    });
    expect(videoStorageService.headObject).not.toHaveBeenCalled();
    expect(videoJobService.queueIfUploadPending).not.toHaveBeenCalled();
  });

  it('should throw PRECONDITION_FAILED DomainError when the object is missing in S3', async () => {
    videoJobService.findById.mockResolvedValue(buildJob());
    videoStorageService.headObject.mockResolvedValue(false);

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.PRECONDITION_FAILED
    });
    expect(videoJobService.queueIfUploadPending).not.toHaveBeenCalled();
  });

  it('should throw INVALID_STATE DomainError when a cancel or the expiration wins the race', async () => {
    videoJobService.findById.mockResolvedValue(buildJob());
    videoStorageService.headObject.mockResolvedValue(true);
    // O job foi a EXPIRED entre o findById e o queueIfUploadPending: a escrita condicional não bate.
    videoJobService.queueIfUploadPending.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.INVALID_STATE,
      message: 'Video job is not awaiting upload confirmation'
    });
  });
});
