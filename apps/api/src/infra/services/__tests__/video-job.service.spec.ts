import { prisma } from '@4frames/shared/prisma';

import { VideoJobService } from '../video-job.service';

jest.mock('@4frames/shared/prisma', () => ({
  prisma: {
    video_jobs: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

describe('VideoJobService (confirmação do upload)', () => {
  const mockFindUnique = prisma.video_jobs.findUnique as jest.Mock;
  const mockUpdateMany = prisma.video_jobs.updateMany as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should move the job to QUEUED only while it is UPLOAD_PENDING and owned by the user', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: JOB_ID,
      user_id: 1,
      file_name: 'my-video.mp4',
      content_type: 'video/mp4',
      file_size: BigInt(1024),
      status: 'QUEUED',
      failure_reason: null,
      zip_key: null,
      created_at: new Date('2026-01-01T00:00:00.000Z')
    });

    await expect(new VideoJobService().queueIfUploadPending(JOB_ID, 1)).resolves.toMatchObject({
      id: JOB_ID,
      status: 'QUEUED',
      fileSize: 1024
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, user_id: 1, status: 'UPLOAD_PENDING' },
      data: { status: 'QUEUED' }
    });
  });

  it('should return null without reading the job when the conditional write does not match', async () => {
    // Cancelado ou expirado entre a leitura do use case e esta escrita.
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(new VideoJobService().queueIfUploadPending(JOB_ID, 1)).resolves.toBeNull();

    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe('VideoJobService (expiração)', () => {
  const mockUpdateMany = prisma.video_jobs.updateMany as jest.Mock;
  const mockCount = prisma.video_jobs.count as jest.Mock;
  const cutoff = new Date('2026-09-27T11:54:00.000Z');

  it('should expire, in one conditional write, only UPLOAD_PENDING jobs created before the cutoff', async () => {
    mockUpdateMany.mockResolvedValue({ count: 4 });

    await expect(new VideoJobService().expireUploadPendingCreatedBefore(cutoff)).resolves.toBe(4);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { status: 'UPLOAD_PENDING', created_at: { lt: cutoff } },
      data: { status: 'EXPIRED' }
    });
  });

  it('should count PROCESSING jobs not updated since the cutoff', async () => {
    mockCount.mockResolvedValue(1);

    await expect(new VideoJobService().countProcessingNotUpdatedSince(cutoff)).resolves.toBe(1);

    expect(mockCount).toHaveBeenCalledWith({ where: { status: 'PROCESSING', updated_at: { lt: cutoff } } });
  });
});
