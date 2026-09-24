import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { GetVideoJobDownloadUrlUseCase } from './get-video-job-download-url.usecase';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';
const MISSING_JOB_ID = '00000000-0000-4000-8000-000000000000';
const ZIP_KEY = `zips/1/${JOB_ID}.zip`;

function buildJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
  return {
    id: JOB_ID,
    userId: 1,
    fileName: 'my-video.mp4',
    contentType: 'video/mp4',
    fileSize: 1024,
    status: 'DONE',
    failureReason: null,
    zipKey: ZIP_KEY,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('GetVideoJobDownloadUrlUseCase', () => {
  let useCase: GetVideoJobDownloadUrlUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;
  let videoStorageService: jest.Mocked<IVideoStorageService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      listByUser: jest.fn(),
      cancelIfPending: jest.fn()
    };

    videoStorageService = {
      generatePresignedUploadUrl: jest.fn(),
      generatePresignedDownloadUrl: jest.fn(),
      headObject: jest.fn()
    };

    useCase = new GetVideoJobDownloadUrlUseCase({ videoJobService, videoStorageService });
  });

  it('should return a presigned download url when the job is DONE', async () => {
    videoJobService.findById.mockResolvedValue(buildJob());
    videoStorageService.generatePresignedDownloadUrl.mockResolvedValue({
      downloadUrl: 'https://bucket.example.com/signed',
      expiresIn: 300
    });

    const result = await useCase.execute({ userId: 1, jobId: JOB_ID });

    expect(videoStorageService.generatePresignedDownloadUrl).toHaveBeenCalledWith(ZIP_KEY, 300);
    expect(result).toEqual({
      downloadUrl: 'https://bucket.example.com/signed',
      expiresIn: 300
    });
  });

  it('should throw NOT_FOUND DomainError when the job does not exist', async () => {
    videoJobService.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: MISSING_JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoStorageService.generatePresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND DomainError when the job belongs to another user', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ userId: 2 }));

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoStorageService.generatePresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it.each(['UPLOAD_PENDING', 'QUEUED', 'PROCESSING', 'FAILED', 'EXPIRED'])(
    'should throw INVALID_STATE DomainError when the job status is %s',
    async status => {
      videoJobService.findById.mockResolvedValue(buildJob({ status }));

      await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toBeInstanceOf(DomainError);
      await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
        type: DomainErrorTypes.INVALID_STATE
      });
      expect(videoStorageService.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    }
  );

  it('should throw PRECONDITION_FAILED DomainError when the job is DONE but has no zip key', async () => {
    videoJobService.findById.mockResolvedValue(buildJob({ zipKey: null }));

    await expect(useCase.execute({ userId: 1, jobId: JOB_ID })).rejects.toMatchObject({
      type: DomainErrorTypes.PRECONDITION_FAILED
    });
    expect(videoStorageService.generatePresignedDownloadUrl).not.toHaveBeenCalled();
  });
});
