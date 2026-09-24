import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import { type IUseCase } from '@/domain/ports/use-case';

import { CancelVideoJobController } from '../cancel-video-job.controller';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

describe('CancelVideoJobController', () => {
  let controller: CancelVideoJobController;
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
      params: { jobId: JOB_ID }
    };

    mockResponse = {
      status: mockStatus
    };

    controller = new CancelVideoJobController(mockUseCase);
  });

  it('should cancel the job successfully', async () => {
    const mockResult = {
      jobId: JOB_ID,
      status: 'EXPIRED'
    };
    mockUseCase.execute.mockResolvedValue(mockResult);

    await controller.handle(mockRequest as Request, mockResponse as Response);

    expect(mockUseCase.execute).toHaveBeenCalledWith({ userId: 1, jobId: JOB_ID });
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledWith(mockResult);
  });

  it.each(['42', 'abc'])('should throw InvalidRequestParamError when jobId is not a UUID (%s)', async jobId => {
    mockRequest.params = { jobId };

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      InvalidRequestParamError
    );
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('should propagate errors from the use case', async () => {
    const mockError = new Error('Video job can no longer be canceled');
    mockUseCase.execute.mockRejectedValue(mockError);

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      'Video job can no longer be canceled'
    );
  });
});
