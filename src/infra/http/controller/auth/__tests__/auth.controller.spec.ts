import { type Request, type Response } from 'express';

import { type IUseCase } from '@/domain/ports/use-case';

import { AuthController } from '../auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
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
      body: {
        email: 'test@example.com',
        password: 'password123'
      }
    };

    mockResponse = {
      status: mockStatus
    };

    controller = new AuthController(mockUseCase);
  });

  it('should authenticate user successfully', async () => {
    const mockResult = {
      accessToken: 'jwt-token',
      expireIn: 21600,
      user: { id: 1, email: 'test@example.com' }
    };
    mockUseCase.execute.mockResolvedValue(mockResult);

    await controller.handle(mockRequest as Request, mockResponse as Response);

    expect(mockUseCase.execute).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123'
    });
    expect(mockStatus).toHaveBeenCalledWith(201);
    expect(mockJson).toHaveBeenCalledWith(mockResult);
  });

  it('should handle authentication error', async () => {
    const mockError = new Error('Invalid credentials');
    mockUseCase.execute.mockRejectedValue(mockError);

    await expect(controller.handle(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
      'Invalid credentials'
    );
  });
});
