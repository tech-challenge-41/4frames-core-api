import { Router } from 'express';

import { routes as authRoutes } from './auth';
import { routes as videoRoutes } from './video';

const routes = Router();

routes.use('/auth', authRoutes);
routes.use('/videos', videoRoutes);

export { routes };
