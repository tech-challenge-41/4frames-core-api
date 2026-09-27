import express from 'express';
import request from 'supertest';

import { type CheckReadinessOutputDTO } from '@/application/use-case/system/check-readiness/check-readiness.dto';
import { Container } from '@/dependencies/container';
import { type IUseCase } from '@/domain/ports/use-case';

import { ReadinessController } from '../../controller/system/readiness.controller';
import { routes as systemRoutes } from '../system';

jest.mock('@/dependencies/container');

describe('System routes', () => {
  let useCase: jest.Mocked<IUseCase<void, CheckReadinessOutputDTO>>;

  function createApp(): express.Application {
    const app = express();
    app.use(systemRoutes);
    return app;
  }

  beforeEach(() => {
    useCase = { execute: jest.fn() };
    const container = { resolve: jest.fn().mockReturnValue(new ReadinessController(useCase)) };
    (Container.getInstance as jest.Mock).mockReturnValue(container);
  });

  it('should serve GET /ready without authentication', async () => {
    useCase.execute.mockResolvedValue({ ready: true, checks: { database: 'up', redis: 'up' } });

    const response = await request(createApp()).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks: { database: 'up', redis: 'up' } });
  });

  it('should answer 503 on GET /ready when a dependency is down', async () => {
    useCase.execute.mockResolvedValue({ ready: false, checks: { database: 'up', redis: 'down' } });

    const response = await request(createApp()).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.checks).toEqual({ database: 'up', redis: 'down' });
  });
});
