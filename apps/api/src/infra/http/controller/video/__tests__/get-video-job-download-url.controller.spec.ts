import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import { type IUseCase } from '@/domain/ports/use-case';

import { GetVideoJobDownloadUrlController } from '../get-video-job-download-url.controller';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

describe('GetVideoJobDownloadUrlController', () => {
  let controller: GetVideoJobDownloadUrlController;
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

    controller = new GetVideoJobDownloadUrlController(mockUseCase);
  });

  it('should return the presigned download url', async () => {
    const mockResult = {
      downloadUrl: 'https://bucket.example.com/signed',
      expiresIn: 300
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
    const mockError = new Error('Video job is not done yet');
    mockUseCase.execute.mockRejectedValue(mockError);

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      'Video job is not done yet'
    );
  });
});
