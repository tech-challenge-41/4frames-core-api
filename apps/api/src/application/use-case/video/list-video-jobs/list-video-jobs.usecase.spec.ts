import { type IJobProgressReader } from '@/domain/ports/service/job-progress-reader.service.interface';
import { type IVideoJobService, type VideoJobRecord } from '@/domain/ports/service/video-job.service.interface';

import { ListVideoJobsUseCase } from './list-video-jobs.usecase';

const USER_ID = 1;

function buildJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
  return {
    id: '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10',
    userId: USER_ID,
    fileName: 'my-video.mp4',
    contentType: 'video/mp4',
    fileSize: 1024,
    status: 'DONE',
    failureReason: null,
    zipKey: 'zips/1/6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10.zip',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('ListVideoJobsUseCase', () => {
  let useCase: ListVideoJobsUseCase;
  let videoJobService: jest.Mocked<IVideoJobService>;
  let jobProgressReader: jest.Mocked<IJobProgressReader>;

  beforeEach(() => {
    videoJobService = {
      createUploadPendingJob: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      listByUser: jest.fn(),
      cancelIfPending: jest.fn()
    };

    jobProgressReader = { getMany: jest.fn().mockResolvedValue(new Map()) };

    useCase = new ListVideoJobsUseCase({ videoJobService, jobProgressReader });
  });

  it('should return an empty list when the user has no jobs', async () => {
    videoJobService.listByUser.mockResolvedValue({ items: [], total: 0 });

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(videoJobService.listByUser).toHaveBeenCalledWith(USER_ID, { limit: 20, offset: 0 });
    expect(result).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('should map jobs to the list DTO, marking DONE jobs with a zip as downloadable', async () => {
    videoJobService.listByUser.mockResolvedValue({
      items: [buildJob()],
      total: 1
    });

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(result.items).toEqual([
      {
        jobId: '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10',
        fileName: 'my-video.mp4',
        status: 'DONE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        hasDownload: true
      }
    ]);
  });

  it('should not expose the raw zip key on any list item', async () => {
    videoJobService.listByUser.mockResolvedValue({ items: [buildJob()], total: 1 });

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(result.items[0]).not.toHaveProperty('zipKey');
  });

  it('should set hasDownload to false when the job is not DONE', async () => {
    videoJobService.listByUser.mockResolvedValue({
      items: [buildJob({ status: 'PROCESSING', zipKey: null })],
      total: 1
    });

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(result.items[0].hasDownload).toBe(false);
  });

  it('should set hasDownload to false when the job is DONE but has no zip key', async () => {
    videoJobService.listByUser.mockResolvedValue({
      items: [buildJob({ status: 'DONE', zipKey: null })],
      total: 1
    });

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(result.items[0].hasDownload).toBe(false);
  });

  it('should include failureReason only when present', async () => {
    videoJobService.listByUser.mockResolvedValue({
      items: [buildJob({ status: 'FAILED', zipKey: null, failureReason: 'Arquivo corrompido' })],
      total: 1
    });

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(result.items[0].failureReason).toBe('Arquivo corrompido');
  });

  it('should forward pagination params to the service and echo them back in the output', async () => {
    videoJobService.listByUser.mockResolvedValue({ items: [], total: 42 });

    const result = await useCase.execute({ userId: USER_ID, limit: 5, offset: 10 });

    expect(videoJobService.listByUser).toHaveBeenCalledWith(USER_ID, { limit: 5, offset: 10 });
    expect(result).toEqual({ items: [], total: 42, limit: 5, offset: 10 });
  });

  it('should read the progress of PROCESSING jobs only, in one call, and add it where there is one', async () => {
    const processingWithProgress = buildJob({ id: 'job-a', status: 'PROCESSING', zipKey: null });
    const processingWithoutProgress = buildJob({ id: 'job-b', status: 'PROCESSING', zipKey: null });
    const done = buildJob({ id: 'job-c' });
    videoJobService.listByUser.mockResolvedValue({
      items: [processingWithProgress, processingWithoutProgress, done],
      total: 3
    });
    jobProgressReader.getMany.mockResolvedValue(new Map([['job-a', 42]]));

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(jobProgressReader.getMany).toHaveBeenCalledTimes(1);
    expect(jobProgressReader.getMany).toHaveBeenCalledWith(['job-a', 'job-b']);
    expect(result.items[0].progress).toBe(42);
    expect(result.items[1]).not.toHaveProperty('progress');
    expect(result.items[2]).not.toHaveProperty('progress');
  });

  it('should not show the 100 % the worker leaves behind for a DONE job', async () => {
    videoJobService.listByUser.mockResolvedValue({ items: [buildJob({ id: 'job-c' })], total: 1 });
    jobProgressReader.getMany.mockResolvedValue(new Map([['job-c', 100]]));

    const result = await useCase.execute({ userId: USER_ID, limit: 20, offset: 0 });

    expect(jobProgressReader.getMany).toHaveBeenCalledWith([]);
    expect(result.items[0]).not.toHaveProperty('progress');
  });
});
