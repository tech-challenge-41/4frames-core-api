import { Router } from 'express';

import { AuthController } from '@/infra/http/controller/auth/auth.controller';
import { controllerWrapper } from '@/infra/http/middlewares/controller-wrapper.middleware';
import { validateMiddleware } from '@/infra/http/middlewares/validate/validate.middleware';
import authUserSchema from '@/infra/http/validators/auth/auth-user.validator';

import { getRateLimiterMiddleware } from '../middlewares/rate-limiter.middleware';

const routes = Router();

routes.use(getRateLimiterMiddleware());

const authenticate = [validateMiddleware(authUserSchema), controllerWrapper(AuthController.name)];

// POST /auth/login é a rota do ADR-001. POST /auth continua respondendo igual para quem já a usa e aparece
// como deprecated no OpenAPI. As duas passam pelo mesmo rate limiter.
routes.post('/login', ...authenticate);
routes.post('/', ...authenticate);

export { routes };
