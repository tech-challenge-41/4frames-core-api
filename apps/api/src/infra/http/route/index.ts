import { Router } from 'express';

import { routes as authRoutes } from './auth';
import { routes as systemRoutes } from './system';
import { routes as videoRoutes } from './video';

export interface ApiRouter {
  prefix: string;
  router: Router;
}

/**
 * Os routers da API e o prefixo de cada um. O Express 5 não guarda o prefixo de um `use` como texto, então o
 * teste de paridade com o OpenAPI (`infra/http/__tests__/openapi-parity.spec.ts`) lê os caminhos daqui.
 */
export const apiRouters: readonly ApiRouter[] = [
  { prefix: '/auth', router: authRoutes },
  { prefix: '/videos', router: videoRoutes },
  { prefix: '/', router: systemRoutes }
];

const routes = Router();

for (const { prefix, router } of apiRouters) {
  routes.use(prefix, router);
}

export { routes };
