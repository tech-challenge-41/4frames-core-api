import { Router } from 'express';

import { CancelVideoJobController } from '@/infra/http/controller/video/cancel-video-job.controller';
import { CompleteVideoJobController } from '@/infra/http/controller/video/complete-video-job.controller';
import { GetVideoJobDownloadUrlController } from '@/infra/http/controller/video/get-video-job-download-url.controller';
import { GetVideoJobEventsController } from '@/infra/http/controller/video/get-video-job-events.controller';
import { GetVideoJobStatusController } from '@/infra/http/controller/video/get-video-job-status.controller';
import { ListVideoJobsController } from '@/infra/http/controller/video/list-video-jobs.controller';
import { VideoController } from '@/infra/http/controller/video/video.controller';
import { authMiddleware } from '@/infra/http/middlewares/auth.middleware';
import { controllerWrapper } from '@/infra/http/middlewares/controller-wrapper.middleware';
import { sseAuthMiddleware } from '@/infra/http/middlewares/sse-auth.middleware';
import { validateMiddleware } from '@/infra/http/middlewares/validate/validate.middleware';
import createVideoJobSchema from '@/infra/http/validators/video/create-video-job.validator';

const routes = Router();

routes.post('/', authMiddleware, validateMiddleware(createVideoJobSchema), controllerWrapper(VideoController.name));

routes.get('/', authMiddleware, controllerWrapper(ListVideoJobsController.name));

routes.get('/:jobId', authMiddleware, controllerWrapper(GetVideoJobStatusController.name));

routes.post('/:jobId/complete', authMiddleware, controllerWrapper(CompleteVideoJobController.name));

routes.post('/:jobId/cancel', authMiddleware, controllerWrapper(CancelVideoJobController.name));

routes.get('/:jobId/download', authMiddleware, controllerWrapper(GetVideoJobDownloadUrlController.name));

routes.get('/:jobId/events', sseAuthMiddleware, controllerWrapper(GetVideoJobEventsController.name));

export { routes };
