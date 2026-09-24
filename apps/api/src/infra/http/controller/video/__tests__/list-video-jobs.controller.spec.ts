import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import { type IUseCase } from '@/domain/ports/use-case';

import { ListVideoJobsController } from '../list-video-jobs.controller';

describe('ListVideoJobsController', () => {
  let controller: ListVideoJobsController;
  let mockUseCase: jest.Mocked<IUseCase<any, any>>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockUseCase = {
      execute: jest.fn()
    };

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockRequest = {
      authenticated: { userId: 1 },
      query: {}
    };

    mockResponse = {
      status: mockStatus
    };

    controller = new ListVideoJobsController(mockUseCase);
  });

  it('should list jobs with default pagination when no query params are given', async () => {
    const mockResult = { items: [], total: 0, limit: 20, offset: 0 };
    mockUseCase.execute.mockResolvedValue(mockResult);

    await controller.handle(mockRequest as Request, mockResponse as Response);

    expect(mockUseCase.execute).toHaveBeenCalledWith({ userId: 1, limit: 20, offset: 0 });
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(mockResult);
  });

  it('should forward limit and offset from the query string', async () => {
    mockRequest.query = { limit: '5', offset: '10' };
    mockUseCase.execute.mockResolvedValue({ items: [], total: 0, limit: 5, offset: 10 });

    await controller.handle(mockRequest as Request, mockResponse as Response);

    expect(mockUseCase.execute).toHaveBeenCalledWith({ userId: 1, limit: 5, offset: 10 });
  });

  it('should throw InvalidRequestParamError when limit is invalid', async () => {
    mockRequest.query = { limit: 'abc' };

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      InvalidRequestParamError
    );
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('should propagate errors from the use case', async () => {
    const mockError = new Error('boom');
    mockUseCase.execute.mockRejectedValue(mockError);

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow('boom');
  });
});
