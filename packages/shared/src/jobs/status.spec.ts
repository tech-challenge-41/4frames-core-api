import { isTerminalVideoJobStatus, isVideoJobStatus, VIDEO_JOB_STATUSES } from './status';
import { VideoJobStatus } from '../generated/prisma/enums';

describe('video job status', () => {
  it('should stay in sync with the Prisma VideoJobStatus enum', () => {
    expect([...VIDEO_JOB_STATUSES]).toEqual(Object.values(VideoJobStatus));
  });

  it('should recognize terminal statuses', () => {
    expect(['DONE', 'FAILED', 'EXPIRED'].every(isTerminalVideoJobStatus)).toBe(true);
    expect(['UPLOAD_PENDING', 'QUEUED', 'PROCESSING'].some(isTerminalVideoJobStatus)).toBe(false);
  });

  it('should validate status names', () => {
    expect(isVideoJobStatus('QUEUED')).toBe(true);
    expect(isVideoJobStatus('queued')).toBe(false);
  });
});
