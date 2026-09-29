import { Router } from 'express';

import { ReadinessController } from '@/infra/http/controller/system/readiness.controller';
import { controllerWrapper } from '@/infra/http/middlewares/controller-wrapper.middleware';

const routes = Router();

// Sem autenticação: quem chama é o kubelet (readiness probe).
routes.get('/ready', controllerWrapper(ReadinessController.name));

export { routes };
