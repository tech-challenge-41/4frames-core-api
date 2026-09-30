import { type Request, type Response } from 'express';

import { type CheckReadinessOutputDTO } from '@/application/use-case/system/check-readiness/check-readiness.dto';
import { type IUseCase } from '@/domain/ports/use-case';

import { ReadinessController } from '../readiness.controller';

function createResponse(): jest.Mocked<Pick<Response, 'status' | 'json'>> {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as jest.Mocked<Pick<Response, 'status' | 'json'>>;
}

describe('ReadinessController', () => {
  let useCase: jest.Mocked<IUseCase<void, CheckReadinessOutputDTO>>;
  let controller: ReadinessController;

  beforeEach(() => {
    useCase = { execute: jest.fn() };
    controller = new ReadinessController(useCase);
  });

  it('should answer 200 when every dependency is up', async () => {
    useCase.execute.mockResolvedValue({ ready: true, checks: { database: 'up', redis: 'up' } });
    const response = createResponse();

    await controller.handle({} as Request, response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ status: 'ready', checks: { database: 'up', redis: 'up' } });
  });

  it('should answer 503 when a dependency is down', async () => {
    useCase.execute.mockResolvedValue({ ready: false, checks: { database: 'down', redis: 'up' } });
    const response = createResponse();

    await controller.handle({} as Request, response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      status: 'unavailable',
      checks: { database: 'down', redis: 'up' }
    });
  });
});
