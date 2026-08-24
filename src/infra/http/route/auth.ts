import { Router } from 'express';

import { AuthController } from '@/infra/http/controller/auth/auth.controller';
import { controllerWrapper } from '@/infra/http/middlewares/controller-wrapper.middleware';
import { validateMiddleware } from '@/infra/http/middlewares/validate/validate.middleware';
import authUserSchema from '@/infra/http/validators/auth/auth-user.validator';

import { getRateLimiterMiddleware } from '../middlewares/rate-limiter.middleware';

const routes = Router();

routes.use(getRateLimiterMiddleware());

routes.post('/', validateMiddleware(authUserSchema), controllerWrapper(AuthController.name));

export { routes };
