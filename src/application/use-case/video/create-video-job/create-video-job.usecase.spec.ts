import { VideoValidationError } from '@/application/error/video-validation-error';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { CreateVideoJobUseCase } from './create-video-job.usecase';

describe('CreateVideoJobUseCase', () => {
  let useCase: CreateVideoJobUseCase;
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

    useCase = new CreateVideoJobUseCase({
      videoJobService,
      videoStorageService
    });
  });

  it('should create a job and return a presigned upload URL', async () => {
    videoJobService.createUploadPendingJob.mockResolvedValue({
      id: 42,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      status: 'UPLOAD_PENDING'
    });

    videoStorageService.generatePresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://s3.example.com/signed-url',
      expiresIn: 300
    });

    const result = await useCase.execute({
      userId: 1,
      fileName: 'my-video.mp4',
      fileSize: 1024,
      contentType: 'video/mp4'
    });

    expect(videoJobService.createUploadPendingJob).toHaveBeenCalledWith(1, 'my-video.mp4', 'video/mp4');
    expect(videoStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith(
      'videos/1/42/source.mp4',
      'video/mp4',
      300
    );
    expect(result).toEqual({
      jobId: 42,
      uploadUrl: 'https://s3.example.com/signed-url',
      expiresIn: 300
    });
  });

  it('should build the key with the .mov extension for video/quicktime', async () => {
    videoJobService.createUploadPendingJob.mockResolvedValue({
      id: 7,
      userId: 5,
      fileName: 'clip.mov',
      contentType: 'video/quicktime',
      status: 'UPLOAD_PENDING'
    });

    videoStorageService.generatePresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://s3.example.com/signed-url-mov',
      expiresIn: 300
    });

    await useCase.execute({
      userId: 5,
      fileName: 'clip.mov',
      fileSize: 2048,
      contentType: 'video/quicktime'
    });

    expect(videoStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith(
      'videos/5/7/source.mov',
      'video/quicktime',
      300
    );
  });

  it('should throw VideoValidationError for an unsupported content type', async () => {
    await expect(
      useCase.execute({
        userId: 1,
        fileName: 'video.avi',
        fileSize: 1024,
        contentType: 'video/avi'
      })
    ).rejects.toThrow(VideoValidationError);

    expect(videoJobService.createUploadPendingJob).not.toHaveBeenCalled();
    expect(videoStorageService.generatePresignedUploadUrl).not.toHaveBeenCalled();
  });
});
