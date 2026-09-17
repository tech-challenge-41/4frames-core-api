import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { CompleteVideoJobUseCase } from './complete-video-job.usecase';

describe('CompleteVideoJobUseCase', () => {
  let useCase: CompleteVideoJobUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;
  let videoStorageService: jest.Mocked<IVideoStorageService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn()
    };

    videoStorageService = {
      generatePresignedUploadUrl: jest.fn(),
      headObject: jest.fn()
    };

    useCase = new CompleteVideoJobUseCase({ videoJobService, videoStorageService });
  });

  it('should confirm the upload and move the job from UPLOAD_PENDING to QUEUED', async () => {
    videoJobService.findById.mockResolvedValue({
      id: 42,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'UPLOAD_PENDING'
    });
    videoStorageService.headObject.mockResolvedValue(true);
    videoJobService.updateStatus.mockResolvedValue({
      id: 42,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'QUEUED'
    });

    const result = await useCase.execute({ userId: 1, jobId: 42 });

    expect(videoStorageService.headObject).toHaveBeenCalledWith('videos/1/42/source.mp4');
    expect(videoJobService.updateStatus).toHaveBeenCalledWith(42, 'QUEUED');
    expect(result).toEqual({
      jobId: 42,
      status: 'QUEUED',
      fileName: 'my-video.mp4'
    });
  });

  it('should throw NOT_FOUND DomainError when the job does not exist', async () => {
    videoJobService.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: 999 })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoStorageService.headObject).not.toHaveBeenCalled();
    expect(videoJobService.updateStatus).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND DomainError when the job belongs to another user', async () => {
    videoJobService.findById.mockResolvedValue({
      id: 42,
      userId: 2,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'UPLOAD_PENDING'
    });

    await expect(useCase.execute({ userId: 1, jobId: 42 })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
    expect(videoStorageService.headObject).not.toHaveBeenCalled();
  });

  it('should throw INVALID_STATE DomainError when the job is not UPLOAD_PENDING', async () => {
    videoJobService.findById.mockResolvedValue({
      id: 42,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'QUEUED'
    });

    await expect(useCase.execute({ userId: 1, jobId: 42 })).rejects.toBeInstanceOf(DomainError);
    await expect(useCase.execute({ userId: 1, jobId: 42 })).rejects.toMatchObject({
      type: DomainErrorTypes.INVALID_STATE
    });
    expect(videoStorageService.headObject).not.toHaveBeenCalled();
    expect(videoJobService.updateStatus).not.toHaveBeenCalled();
  });

  it('should throw PRECONDITION_FAILED DomainError when the object is missing in S3', async () => {
    videoJobService.findById.mockResolvedValue({
      id: 42,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'UPLOAD_PENDING'
    });
    videoStorageService.headObject.mockResolvedValue(false);

    await expect(useCase.execute({ userId: 1, jobId: 42 })).rejects.toMatchObject({
      type: DomainErrorTypes.PRECONDITION_FAILED
    });
    expect(videoJobService.updateStatus).not.toHaveBeenCalled();
  });
});
