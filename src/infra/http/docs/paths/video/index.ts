import { completeVideoJobPath } from './complete-video-job.path';
import { createVideoJobPath } from './create-video-job.path';
import { getVideoJobStatusPath } from './get-video-job-status.path';

export const videoPaths = {
  ...createVideoJobPath,
  ...getVideoJobStatusPath,
  ...completeVideoJobPath
};
