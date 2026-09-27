import { Router } from 'express';

import { routes as authRoutes } from './auth';
import { routes as systemRoutes } from './system';
import { routes as videoRoutes } from './video';

const routes = Router();

routes.use('/auth', authRoutes);
routes.use('/videos', videoRoutes);
routes.use(systemRoutes);

export { routes };
