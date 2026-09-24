import { type NextFunction, type Request, type Response } from 'express';

import { AuthError } from '@/application/error/auth-error';
import { Container } from '@/dependencies/container';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';

import { sseAuthMiddleware } from '../sse-auth.middleware';

jest.mock('@/dependencies/container', () => ({
  Container: {
    getInstance: jest.fn()
  }
}));

describe('sseAuthMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockJwtAuthenticator: { verifyAuthorizationHeader: jest.Mock };
  let mockContainer: jest.Mocked<Container>;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      query: {},
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

  it('should authenticate using the token from the query string', async () => {
    mockRequest.query = { token: 'query-token' };
    mockJwtAuthenticator.verifyAuthorizationHeader.mockResolvedValue({ userId: 1 });

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith('Bearer query-token');
    expect(mockRequest.authenticated?.userId).toBe(1);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should prefer the Authorization header over the query token when both are present', async () => {
    mockRequest.headers = { authorization: 'Bearer header-token' };
    mockRequest.query = { token: 'query-token' };
    mockJwtAuthenticator.verifyAuthorizationHeader.mockResolvedValue({ userId: 1 });

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith('Bearer header-token');
  });

  it('should fall back to the Authorization header when there is no query token', async () => {
    mockRequest.headers = { authorization: 'Bearer header-token' };
    mockJwtAuthenticator.verifyAuthorizationHeader.mockResolvedValue({ userId: 1 });

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith('Bearer header-token');
  });

  it('should pass undefined when neither the header nor the query token are present', async () => {
    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue(
      new AuthError('Authorization header is missing', { reason: 'MISSING_AUTHORIZATION' })
    );

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith(undefined);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when the token is invalid', async () => {
    mockRequest.query = { token: 'invalid' };
    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue(new AuthError('Invalid token'));

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should ignore a non-string token query value', async () => {
    mockRequest.query = { token: ['array', 'value'] as any };
    mockJwtAuthenticator.verifyAuthorizationHeader.mockRejectedValue(
      new AuthError('Authorization header is missing', { reason: 'MISSING_AUTHORIZATION' })
    );

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockJwtAuthenticator.verifyAuthorizationHeader).toHaveBeenCalledWith(undefined);
  });

  it('should resolve JWT authenticator from container', async () => {
    mockRequest.query = { token: 'query-token' };
    mockJwtAuthenticator.verifyAuthorizationHeader.mockResolvedValue({ userId: 1 });

    await sseAuthMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(Container.getInstance).toHaveBeenCalled();
    expect(mockContainer.resolve).toHaveBeenCalledWith(JwtAuthenticatorService.name);
  });
});
