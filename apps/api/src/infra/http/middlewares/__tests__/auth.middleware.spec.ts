import { type Request, type Response, type NextFunction } from 'express';

import { AuthError } from '@/application/error/auth-error';
import { Container } from '@/dependencies/container';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';

import { authMiddleware } from '../auth.middleware';

jest.mock('@/dependencies/container', () => ({
  Container: {
    getInstance: jest.fn()
  }
}));

describe('authMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockJwtAuthenticator: { verifyAuthorizationHeader: jest.Mock };
  let mockContainer: jest.Mocked<Container>;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      params: {}
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();

    mockJwtAuthenticator = {
      verifyAuthorizationHeader: jest.fn()
    };

    mockContainer = {
      resolve: jest.fn().mockReturnValue(mockJwtAuthenticator)
    } as any;

    (Container.getInstance as jest.Mock).mockReturnValue(mockContainer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if authorization header is missing', async () => {
    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue(
      new AuthError('Authorization header is missing', {
        reason: 'MISSING_AUTHORIZATION'
      })
    );

    await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Authorization header is missing'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if token is missing in authorization header', async () => {
    mockRequest.headers = {
      authorization: 'Bearer '
    };

    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue(
      new AuthError('Token is missing', { reason: 'MISSING_TOKEN' })
    );

    await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Token is missing'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if token is invalid', async () => {
    mockRequest.headers = {
      authorization: 'Bearer invalid-token'
    };

    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue(new AuthError('Invalid token'));

    await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith('Bearer invalid-token');
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Invalid token'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 with generic message if error has no message', async () => {
    mockRequest.headers = {
      authorization: 'Bearer invalid-token'
    };

    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue({});

    await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Invalid token'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should set userId in request authenticated and call next if token is valid', async () => {
    const userId = 123456;
    mockRequest.headers = {
      authorization: 'Bearer valid-token'
    };

    mockJwtAuthenticator.verifyAuthorizationHeader.mockResolvedValue({
      userId
    });

    await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith('Bearer valid-token');
    expect(mockRequest.authenticated?.userId).toBe(userId);
    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();
  });

  it('should resolve JWT authenticator from container', async () => {
    mockRequest.headers = {
      authorization: 'Bearer valid-token'
    };

    mockJwtAuthenticator.verifyAuthorizationHeader.mockResolvedValue({
      userId: 123
    });

    await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(Container.getInstance).toHaveBeenCalled();
    expect(mockContainer.resolve).toHaveBeenCalledWith(JwtAuthenticatorService.name);
  });
});
