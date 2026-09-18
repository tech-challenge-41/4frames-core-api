import { cancelVideoJobPath } from './cancel-video-job.path';
import { completeVideoJobPath } from './complete-video-job.path';
import { createVideoJobPath } from './create-video-job.path';
import { getVideoJobDownloadUrlPath } from './get-video-job-download-url.path';
import { getVideoJobEventsPath } from './get-video-job-events.path';
import { getVideoJobStatusPath } from './get-video-job-status.path';
import { listVideoJobsPath } from './list-video-jobs.path';

export const videoPaths = {
  ...createVideoJobPath,
  ...listVideoJobsPath,
  ...getVideoJobStatusPath,
  ...completeVideoJobPath,
  ...getVideoJobDownloadUrlPath,
  ...getVideoJobEventsPath,
  ...cancelVideoJobPath
};
