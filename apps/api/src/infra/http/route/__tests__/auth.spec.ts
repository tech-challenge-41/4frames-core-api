import express from 'express';
import request from 'supertest';

import { type AuthenticateUserOutputDTO } from '@/application/use-case/user/authenticate-user/authenticate-user.dto';
import { Container } from '@/dependencies/container';
import { type IUseCase } from '@/domain/ports/use-case';
import { validateMiddleware } from '@/infra/http/middlewares/validate/validate.middleware';

import { AuthController } from '../../controller/auth/auth.controller';
import { errorHandler } from '../../middlewares/error-handler.middleware';
import { routes as authRoutes } from '../auth';

jest.mock('@/dependencies/container');
jest.mock('@/infra/http/middlewares/validate/validate.middleware', () => ({
  validateMiddleware: jest.fn(() => (req: any, res: any, next: any) => next())
}));

describe('Auth Route Integration Tests', () => {
  let mockUseCase: jest.Mocked<IUseCase<any, AuthenticateUserOutputDTO>>;
  let mockController: AuthController;
  let containerInstance: jest.Mocked<Container>;

  function createApp(): express.Application {
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/auth', authRoutes);
    testApp.use(errorHandler);

    return testApp;
  }

  beforeEach(() => {
    mockUseCase = {
      execute: jest.fn()
    } as any;

    mockController = new AuthController(mockUseCase);

    containerInstance = {
      resolve: jest.fn()
    } as any;

    (Container.getInstance as jest.Mock).mockReturnValue(containerInstance);
    containerInstance.resolve.mockReturnValue(mockController);

    (validateMiddleware as jest.Mock).mockImplementation(() => {
      return (req: any, res: any, next: any) => {
        return next();
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/', () => {
    it('should authenticate user successfully', async () => {
      const mockResult: AuthenticateUserOutputDTO = {
        accessToken: 'jwt-token-123',
        expireIn: 3600,
        user: {
          id: 'user-id-123',
          email: 'test@example.com'
        }
      };

      mockUseCase.execute.mockResolvedValue(mockResult);

      const app = createApp();
      const response = await request(app).post('/auth/').send({
        email: 'test@example.com',
        password: 'password123'
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(mockResult);
      expect(mockUseCase.execute).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      });
    });

    it('should return error when controller throws error', async () => {
      const mockError = new Error('Invalid credentials');
      mockUseCase.execute.mockRejectedValue(mockError);

      const app = createApp();
      const response = await request(app).post('/auth/').send({
        email: 'test@example.com',
        password: 'password123'
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('message', 'Internal server error');
      expect(mockUseCase.execute).toHaveBeenCalled();
    });
  });

  describe('POST /auth/login', () => {
    it('should authenticate with the same controller as POST /auth', async () => {
      const mockResult: AuthenticateUserOutputDTO = {
        accessToken: 'jwt-token-456',
        expireIn: 3600,
        user: { id: 'user-id-123', email: 'test@example.com' }
      };
      mockUseCase.execute.mockResolvedValue(mockResult);

      const response = await request(createApp()).post('/auth/login').send({
        email: 'test@example.com',
        password: 'password123'
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(mockResult);
      expect(mockUseCase.execute).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password123' });
      expect(containerInstance.resolve).toHaveBeenCalledWith(AuthController.name);
    });
  });
});
