import { type Request, type Response } from 'express';

import { type IUseCase } from '@/domain/ports/use-case';

import { VideoController } from '../video.controller';

describe('VideoController', () => {
  let controller: VideoController;
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
      body: {
        fileName: 'my-video.mp4',
        fileSize: 1024,
        contentType: 'video/mp4'
      }
    };

    mockResponse = {
      status: mockStatus
    };

    controller = new VideoController(mockUseCase);
  });

  it('should create a video job successfully', async () => {
    const mockResult = {
      jobId: '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10',
      uploadUrl: 'https://s3.example.com/signed-url',
      expiresIn: 300
    };
    mockUseCase.execute.mockResolvedValue(mockResult);

    await controller.handle(mockRequest as Request, mockResponse as Response);

    expect(mockUseCase.execute).toHaveBeenCalledWith({
      userId: 1,
      fileName: 'my-video.mp4',
      fileSize: 1024,
      contentType: 'video/mp4'
    });
    expect(mockStatus).toHaveBeenCalledWith(201);
    expect(mockJson).toHaveBeenCalledWith(mockResult);
  });

  it('should propagate errors from the use case', async () => {
    const mockError = new Error('Unsupported content type');
    mockUseCase.execute.mockRejectedValue(mockError);

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      'Unsupported content type'
    );
  });
});
