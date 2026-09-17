import { Router } from 'express';

import { CompleteVideoJobController } from '@/infra/http/controller/video/complete-video-job.controller';
import { GetVideoJobStatusController } from '@/infra/http/controller/video/get-video-job-status.controller';
import { VideoController } from '@/infra/http/controller/video/video.controller';
import { authMiddleware } from '@/infra/http/middlewares/auth.middleware';
import { controllerWrapper } from '@/infra/http/middlewares/controller-wrapper.middleware';
import { validateMiddleware } from '@/infra/http/middlewares/validate/validate.middleware';
import createVideoJobSchema from '@/infra/http/validators/video/create-video-job.validator';

const routes = Router();

routes.post('/', authMiddleware, validateMiddleware(createVideoJobSchema), controllerWrapper(VideoController.name));

routes.get('/:jobId', authMiddleware, controllerWrapper(GetVideoJobStatusController.name));

routes.post('/:jobId/complete', authMiddleware, controllerWrapper(CompleteVideoJobController.name));

export { routes };
