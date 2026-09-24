import { prisma } from '@4frames/shared/prisma';

import { PrismaVideoJobNotifierRepository } from './video-job-notifier.repository';

jest.mock('@4frames/shared/prisma', () => ({
  prisma: {
    video_jobs: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn()
    }
  }
}));

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_JOB_ID = '22222222-2222-4222-8222-222222222222';

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    user_id: 1,
    file_name: 'clip.mp4',
    status: 'DONE',
    failure_reason: null,
    frame_count: 30,
    notified_at: null,
    user: { email: 'user@user.com', status: 'ACTIVE' },
    ...overrides
  };
}

describe('PrismaVideoJobNotifierRepository', () => {
  const mockFindUnique = prisma.video_jobs.findUnique as jest.Mock;
  const mockFindMany = prisma.video_jobs.findMany as jest.Mock;
  const mockUpdateMany = prisma.video_jobs.updateMany as jest.Mock;

  const repository = new PrismaVideoJobNotifierRepository();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findForNotify', () => {
    it('should map the job and its owner e-mail', async () => {
      mockFindUnique.mockResolvedValue(buildRow({ status: 'FAILED', failure_reason: 'Vídeo inválido' }));

      await expect(repository.findForNotify(JOB_ID)).resolves.toEqual({
        jobId: JOB_ID,
        userId: 1,
        userEmail: 'user@user.com',
        fileName: 'clip.mp4',
        status: 'FAILED',
        failureReason: 'Vídeo inválido',
        frameCount: 30,
        notifiedAt: null
      });
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: JOB_ID },
        include: { user: { select: { email: true, status: true } } }
      });
    });

    it('should return null when the job does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(repository.findForNotify(JOB_ID)).resolves.toBeNull();
    });

    it('should return null when the owner is not active', async () => {
      mockFindUnique.mockResolvedValue(buildRow({ user: { email: 'user@user.com', status: 'INACTIVE' } }));

      await expect(repository.findForNotify(JOB_ID)).resolves.toBeNull();
    });
  });

  describe('listUnnotifiedTerminal', () => {
    it('should query only terminal jobs not yet notified, oldest first, up to the limit', async () => {
      mockFindMany.mockResolvedValue([]);

      await repository.listUnnotifiedTerminal(25);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { status: { in: ['DONE', 'FAILED'] }, notified_at: null },
        orderBy: { updated_at: 'asc' },
        take: 25,
        include: { user: { select: { email: true, status: true } } }
      });
    });

    it('should skip jobs whose owner is not active', async () => {
      mockFindMany.mockResolvedValue([
        buildRow(),
        buildRow({ id: OTHER_JOB_ID, user: { email: 'gone@user.com', status: 'INACTIVE' } })
      ]);

      const jobs = await repository.listUnnotifiedTerminal(25);

      expect(jobs).toEqual([expect.objectContaining({ jobId: JOB_ID, userEmail: 'user@user.com', status: 'DONE' })]);
    });
  });

  describe('claimForNotify', () => {
    it('should claim with a write conditional on notified_at IS NULL and a terminal status', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await repository.claimForNotify(JOB_ID);

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: JOB_ID, notified_at: null, status: { in: ['DONE', 'FAILED'] } },
        data: { notified_at: expect.any(Date) }
      });
    });

    it('should return true for the process that won the claim', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await expect(repository.claimForNotify(JOB_ID)).resolves.toBe(true);
    });

    it('should return false when another process already claimed the job', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      await expect(repository.claimForNotify(JOB_ID)).resolves.toBe(false);
    });
  });

  describe('releaseClaim', () => {
    it('should clear notified_at so the recovery sweep picks the job again', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await repository.releaseClaim(JOB_ID);

      expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: JOB_ID }, data: { notified_at: null } });
    });
  });
});
