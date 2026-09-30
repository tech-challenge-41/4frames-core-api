import { type Express, type Router } from 'express';
import request from 'supertest';

import { openapi } from '../docs/openapi';
import { createHttpApp } from '../http-app';
import { apiRouters, routes as apiRoutes } from '../route';

// Os middlewares das rotas buscam dependências no Container só ao atender; montar o app não precisa dele.
jest.mock('@/dependencies/container', () => ({ Container: { getInstance: jest.fn() } }));

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

/** Rotas do Express que não são operações da API: a própria documentação. */
const NOT_API_OPERATIONS = new Set(['GET /api-docs']);

/** O que o teste lê de uma camada da pilha do Express 5 (router 2.x). */
interface Layer {
  handle: unknown;
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

function isRouter(handle: unknown): handle is Router {
  return typeof handle === 'function' && Array.isArray((handle as { stack?: unknown }).stack);
}

function stackOf(router: Router): Layer[] {
  return (router as unknown as { stack: Layer[] }).stack;
}

/** `/videos` + `/:jobId/events` → `/videos/{jobId}/events`, no formato das chaves do OpenAPI. */
function toOpenApiPath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');

  return joined.replace(/:(\w+)/g, '{$1}');
}

/**
 * As operações registradas numa pilha, como `MÉTODO /caminho`. Um router montado dentro dela precisa estar em
 * `apiRouters`, a única fonte do prefixo dele: o Express 5 não o guarda como texto.
 */
function registeredOperations(stack: Layer[], prefix = ''): string[] {
  return stack.flatMap(layer => {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods);

      return paths.flatMap(path => methods.map(method => `${method.toUpperCase()} ${toOpenApiPath(prefix, path)}`));
    }

    if (!isRouter(layer.handle)) {
      return [];
    }

    if (layer.handle === apiRoutes) {
      return registeredOperations(stackOf(apiRoutes), prefix);
    }

    const mounted = apiRouters.find(({ router }) => router === layer.handle);

    if (!mounted) {
      throw new Error('Router montado fora de apiRouters (route/index.ts): o teste não sabe o prefixo dele');
    }

    return registeredOperations(stackOf(mounted.router), toOpenApiPath(prefix, mounted.prefix));
  });
}

function documentedOperations(): string[] {
  return Object.entries(openapi.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter(method => HTTP_METHODS.has(method))
      .map(method => `${method.toUpperCase()} ${path}`)
  );
}

describe('OpenAPI × rotas do Express', () => {
  let app: Express;
  let registered: string[];

  beforeAll(() => {
    app = createHttpApp({ connectionCloseMiddleware: (_request, _response, next) => next() });
    registered = registeredOperations(stackOf(app.router as unknown as Router)).filter(
      operation => !NOT_API_OPERATIONS.has(operation)
    );
  });

  it('should find the routes of every router and of the app itself', () => {
    expect(registered).toEqual(
      expect.arrayContaining([
        'POST /auth/login',
        'POST /videos',
        'GET /videos',
        'GET /videos/{jobId}/events',
        'GET /ready',
        'GET /health-check'
      ])
    );
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('should document every route registered in Express', () => {
    const documented = new Set(documentedOperations());

    expect(registered.filter(operation => !documented.has(operation))).toEqual([]);
  });

  it('should have a route for every documented operation', () => {
    const routes = new Set(registered);

    expect(documentedOperations().filter(operation => !routes.has(operation))).toEqual([]);
  });

  it('should serve both POST (create) and GET (list) /videos in the Swagger UI', async () => {
    // O swagger-ui-express embute o documento no script de inicialização da página.
    const response = await request(app).get('/api-docs/swagger-ui-init.js');
    const options = /var options = (\{[\s\S]*?\n\});/.exec(response.text);
    const swaggerDoc = JSON.parse(options?.[1] ?? '{}').swaggerDoc;

    expect(response.status).toBe(200);
    expect(Object.keys(swaggerDoc.paths['/videos'])).toEqual(expect.arrayContaining(['post', 'get']));
  });
});
