import { Router } from 'express';

import { VideoController } from '@/infra/http/controller/video/video.controller';
import { authMiddleware } from '@/infra/http/middlewares/auth.middleware';
import { controllerWrapper } from '@/infra/http/middlewares/controller-wrapper.middleware';
import { validateMiddleware } from '@/infra/http/middlewares/validate/validate.middleware';
import createVideoJobSchema from '@/infra/http/validators/video/create-video-job.validator';

const routes = Router();

routes.post('/', authMiddleware, validateMiddleware(createVideoJobSchema), controllerWrapper(VideoController.name));

export { routes };
