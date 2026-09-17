import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';

import { GetVideoJobStatusUseCase } from './get-video-job-status.usecase';

describe('GetVideoJobStatusUseCase', () => {
  let useCase: GetVideoJobStatusUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn()
    };

    useCase = new GetVideoJobStatusUseCase({ videoJobService });
  });

  it('should return the job status when the job belongs to the user', async () => {
    videoJobService.findById.mockResolvedValue({
      id: 42,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'PROCESSING'
    });

    const result = await useCase.execute({ userId: 1, jobId: 42 });

    expect(videoJobService.findById).toHaveBeenCalledWith(42);
    expect(result).toEqual({
      jobId: 42,
      status: 'PROCESSING',
      fileName: 'my-video.mp4'
    });
  });

  it('should throw NOT_FOUND DomainError when the job does not exist', async () => {
    videoJobService.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 1, jobId: 999 })).rejects.toThrow(DomainError);
    await expect(useCase.execute({ userId: 1, jobId: 999 })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
  });

  it('should throw NOT_FOUND DomainError when the job belongs to another user', async () => {
    videoJobService.findById.mockResolvedValue({
      id: 42,
      userId: 2,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'DONE'
    });

    await expect(useCase.execute({ userId: 1, jobId: 42 })).rejects.toThrow(DomainError);
    await expect(useCase.execute({ userId: 1, jobId: 42 })).rejects.toMatchObject({
      type: DomainErrorTypes.NOT_FOUND
    });
  });
});
