import { type Logger } from '../logger';
import { HealthServer } from './health-server';

function createFakeLogger(): jest.Mocked<Logger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);

  return logger;
}

describe('HealthServer', () => {
  let alive: boolean;
  let server: HealthServer;
  let baseUrl: string;

  beforeEach(async () => {
    alive = true;
    server = new HealthServer({ port: 0, host: '127.0.0.1', isAlive: () => alive, logger: createFakeLogger() });
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('should answer 200 on /healthz while the app reports itself alive', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('should answer 503 when the app reports itself unavailable', async () => {
    alive = false;

    const response = await fetch(`${baseUrl}/healthz?probe=liveness`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'unavailable' });
  });

  it('should answer 404 for other paths and methods', async () => {
    expect((await fetch(`${baseUrl}/metrics`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/healthz`, { method: 'POST' })).status).toBe(404);
  });

  it('should be safe to stop twice', async () => {
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });
});
