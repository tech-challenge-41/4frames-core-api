import { parseJobSourceKey } from './source-key';
import { JOB_ID } from '../__tests__/fakes';

describe('parseJobSourceKey', () => {
  it('should read owner, job and extension from videos/{userId}/{jobId}/source.{ext}', () => {
    expect(parseJobSourceKey(`videos/7/${JOB_ID}/source.mp4`)).toEqual({ userId: 7, jobId: JOB_ID, extension: 'mp4' });
    expect(parseJobSourceKey(`videos/12/${JOB_ID.toUpperCase()}/source.MOV`)).toEqual({
      userId: 12,
      jobId: JOB_ID,
      extension: 'mov'
    });
  });

  it.each([
    `zips/7/${JOB_ID}.zip`,
    `frames/7/${JOB_ID}/frame_0001.png`,
    `videos/7/${JOB_ID}/other.mp4`,
    'videos/7/42/source.mp4',
    `videos/0/${JOB_ID}/source.mp4`,
    `videos/-1/${JOB_ID}/source.mp4`,
    `videos/abc/${JOB_ID}/source.mp4`,
    `videos/99999999999999999999/${JOB_ID}/source.mp4`,
    ''
  ])('should reject %s', key => {
    expect(parseJobSourceKey(key)).toBeNull();
  });
});
