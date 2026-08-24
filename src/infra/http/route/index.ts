import { Router } from 'express';

import { routes as authRoutes } from './auth';

const routes = Router();

routes.use('/auth', authRoutes);

export { routes };
