import { VideoValidationError } from '@/application/error/video-validation-error';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';

import { CreateVideoJobUseCase } from './create-video-job.usecase';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

describe('CreateVideoJobUseCase', () => {
  let useCase: CreateVideoJobUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;
  let videoStorageService: jest.Mocked<IVideoStorageService>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
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

    useCase = new CreateVideoJobUseCase({
      videoJobService,
      videoStorageService
    });
  });

  it('should create a job with the declared file size and return a presigned upload URL', async () => {
    videoJobService.createUploadPendingJob.mockResolvedValue({
      id: JOB_ID,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      fileSize: 1024,
      status: 'UPLOAD_PENDING',
      failureReason: null,
      zipKey: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z')
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

    expect(videoJobService.createUploadPendingJob).toHaveBeenCalledWith({
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      fileSize: 1024
    });
    expect(videoStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith(
      `videos/1/${JOB_ID}/source.mp4`,
      'video/mp4',
      300
    );
    expect(result).toEqual({
      jobId: JOB_ID,
      uploadUrl: 'https://s3.example.com/signed-url',
      expiresIn: 300
    });
  });

  it('should build the key with the .mov extension for video/quicktime', async () => {
    videoJobService.createUploadPendingJob.mockResolvedValue({
      id: JOB_ID,
      userId: 5,
      fileName: 'clip.mov',
      contentType: 'video/quicktime',
      fileSize: 2048,
      status: 'UPLOAD_PENDING',
      failureReason: null,
      zipKey: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z')
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
      `videos/5/${JOB_ID}/source.mov`,
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

  it('should sign the upload URL with the configured expiration', async () => {
    useCase = new CreateVideoJobUseCase({ videoJobService, videoStorageService, uploadUrlExpiresInSeconds: 900 });
    videoJobService.createUploadPendingJob.mockResolvedValue({
      id: JOB_ID,
      userId: 1,
      fileName: 'my-video.mp4',
      contentType: 'video/mp4',
      fileSize: 1024,
      status: 'UPLOAD_PENDING',
      failureReason: null,
      zipKey: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    });
    videoStorageService.generatePresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://s3.example.com/signed-url',
      expiresIn: 900
    });

    const result = await useCase.execute({
      userId: 1,
      fileName: 'my-video.mp4',
      fileSize: 1024,
      contentType: 'video/mp4'
    });

    expect(videoStorageService.generatePresignedUploadUrl).toHaveBeenCalledWith(
      `videos/1/${JOB_ID}/source.mp4`,
      'video/mp4',
      900
    );
    expect(result.expiresIn).toBe(900);
  });
});
