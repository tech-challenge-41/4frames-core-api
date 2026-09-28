import { prisma } from '@4frames/shared/prisma';

import { VideoJobService } from '../video-job.service';

jest.mock('@4frames/shared/prisma', () => ({
  prisma: {
    video_jobs: {
      updateMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

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
