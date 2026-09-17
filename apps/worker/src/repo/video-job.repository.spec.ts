import { PrismaVideoJobRepository } from './video-job.repository';
import { JOB_ID } from '../__tests__/fakes';

describe('PrismaVideoJobRepository', () => {
  let videoJobs: { findUnique: jest.Mock; updateMany: jest.Mock };
  let repository: PrismaVideoJobRepository;

  beforeEach(() => {
    videoJobs = { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    repository = new PrismaVideoJobRepository(videoJobs as never);
  });

  it('should load only what the worker needs', async () => {
    videoJobs.findUnique.mockResolvedValue({ id: JOB_ID, user_id: 7, status: 'QUEUED' });

    await expect(repository.findById(JOB_ID)).resolves.toEqual({ id: JOB_ID, userId: 7, status: 'QUEUED' });
    expect(videoJobs.findUnique).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      select: { id: true, user_id: true, status: true }
    });

    videoJobs.findUnique.mockResolvedValue(null);
    await expect(repository.findById(JOB_ID)).resolves.toBeNull();
  });

  it('should move QUEUED (or an interrupted PROCESSING) to PROCESSING with a conditional update', async () => {
    await expect(repository.markProcessing(JOB_ID)).resolves.toBe(true);
    expect(videoJobs.updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'PROCESSING', failure_reason: null }
    });
  });

  it('should record the result only if the job is still PROCESSING', async () => {
    await expect(
      repository.markDone(JOB_ID, { zipKey: `zips/7/${JOB_ID}.zip`, frameCount: 45, durationSeconds: 45.04 })
    ).resolves.toBe(true);
    expect(videoJobs.updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, status: 'PROCESSING' },
      data: {
        status: 'DONE',
        zip_key: `zips/7/${JOB_ID}.zip`,
        frame_count: 45,
        duration_seconds: 45.04,
        failure_reason: null
      }
    });
  });

  it('should mark FAILED only from QUEUED or PROCESSING', async () => {
    videoJobs.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.markFailed(JOB_ID, 'motivo')).resolves.toBe(false);
    expect(videoJobs.updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'FAILED', failure_reason: 'motivo' }
    });
  });
});
