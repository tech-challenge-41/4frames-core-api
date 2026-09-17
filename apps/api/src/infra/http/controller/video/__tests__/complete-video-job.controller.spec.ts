import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import { type IUseCase } from '@/domain/ports/use-case';

import { CompleteVideoJobController } from '../complete-video-job.controller';

describe('CompleteVideoJobController', () => {
  let controller: CompleteVideoJobController;
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
      params: { jobId: '42' }
    };

    mockResponse = {
      status: mockStatus
    };

    controller = new CompleteVideoJobController(mockUseCase);
  });

  it('should confirm the upload successfully', async () => {
    const mockResult = {
      jobId: 42,
      status: 'QUEUED',
      fileName: 'my-video.mp4'
    };
    mockUseCase.execute.mockResolvedValue(mockResult);

    await controller.handle(mockRequest as Request, mockResponse as Response);

    expect(mockUseCase.execute).toHaveBeenCalledWith({ userId: 1, jobId: 42 });
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(mockResult);
  });

  it('should throw InvalidRequestParamError for a non-numeric jobId', async () => {
    mockRequest.params = { jobId: 'abc' };

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      InvalidRequestParamError
    );
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('should throw InvalidRequestParamError for a negative jobId', async () => {
    mockRequest.params = { jobId: '-1' };

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      InvalidRequestParamError
    );
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('should propagate errors from the use case', async () => {
    const mockError = new Error('Video job is not awaiting upload confirmation');
    mockUseCase.execute.mockRejectedValue(mockError);

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      'Video job is not awaiting upload confirmation'
    );
  });
});
