import bcrypt from 'bcrypt';

import { AuthError } from '@/application/error/auth-error';
import { DomainError } from '@/domain/error/domain-error';
import { type IJwt } from '@/domain/ports/service/jwt.interface';
import { prisma } from '@/infra/db/core/prisma/client';

import { UserAuthenticatorService } from '../user-authenticator.service';

jest.mock('bcrypt');
jest.mock('@/infra/db/core/prisma/client', () => ({
  prisma: {
    users: {
      findUnique: jest.fn()
    }
  }
}));

describe('UserAuthenticatorService', () => {
  const email = 'test@example.com';
  const password = 'pass1234';

  const mockJwt: jest.Mocked<IJwt> = {
    generateToken: jest.fn(),
    verifyToken: jest.fn()
  } as any;

  const mockFindUnique = prisma.users.findUnique as jest.Mock;
  const mockCompare = bcrypt.compare as jest.Mock;
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  let service: UserAuthenticatorService;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserAuthenticatorService({ jwt: mockJwt });
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
    consoleErrorSpy.mockRestore();
  });

  describe('authenticate failures', () => {
    it('should reject when email is empty', async () => {
      await expect(service.authenticate('', password)).rejects.toBeInstanceOf(AuthError);
    });

    it('should reject when password is not a string', async () => {
      await expect(service.authenticate(email, undefined as unknown as string)).rejects.toMatchObject({
        data: { reason: 'PASSWORD_INVALID_PAYLOAD' }
      });
    });

    it('should reject when password length is below minimum', async () => {
      await expect(service.authenticate(email, '123')).rejects.toMatchObject({
        data: { reason: 'INVALID_PASSWORD_LENGTH' }
      });
    });

    it('should reject when password length is above maximum', async () => {
      const longPassword = 'a'.repeat(31);

      await expect(service.authenticate(email, longPassword)).rejects.toMatchObject({
        data: { reason: 'INVALID_PASSWORD_LENGTH' }
      });
    });

    it('should reject when user is not found', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      await expect(service.authenticate(email, password)).rejects.toMatchObject({
        data: { reason: 'INVALID_CREDENTIALS' }
      });
    });

    it('should reject when user is not ACTIVE', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 1,
        email,
        password: 'hash',
        status: 'INACTIVE'
      });

      await expect(service.authenticate(email, password)).rejects.toMatchObject({
        data: { reason: 'USER_INACTIVE' }
      });
    });

    it('should reject when password does not match', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 1,
        email,
        password: 'hash',
        status: 'ACTIVE'
      });
      mockCompare.mockResolvedValueOnce(false);

      await expect(service.authenticate(email, password)).rejects.toMatchObject({
        data: { reason: 'INVALID_CREDENTIALS' }
      });
    });
  });

  describe('authenticate success', () => {
    beforeEach(() => {
      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        email: 'driver@4frames.com',
        password: 'hash',
        status: 'ACTIVE'
      });
      mockCompare.mockResolvedValueOnce(true);
    });

    it('should return a session using default JWT expiration', async () => {
      delete process.env.JWT_EXPIRES_IN;
      mockJwt.generateToken.mockReturnValue('token-default');

      const session = await service.authenticate(email, password);

      expect(mockFindUnique).toHaveBeenCalledWith({ where: { email } });
      expect(mockJwt.generateToken).toHaveBeenCalledWith({ userId: 42 }, 60 * 60 * 6);
      expect(session).toEqual({
        accessToken: 'token-default',
        expireIn: 60 * 60 * 6,
        user: { id: 42, email: 'driver@4frames.com' }
      });
    });

    it('should honor JWT_EXPIRES_IN when set to a positive integer', async () => {
      process.env.JWT_EXPIRES_IN = '900';
      mockJwt.generateToken.mockReturnValue('token-900');

      const session = await service.authenticate(email, password);

      expect(mockJwt.generateToken).toHaveBeenCalledWith({ userId: 42 }, 900);
      expect(session.expireIn).toBe(900);
    });

    it('should fallback to default when JWT_EXPIRES_IN is non-numeric', async () => {
      process.env.JWT_EXPIRES_IN = 'abc';
      mockJwt.generateToken.mockReturnValue('token-fallback');

      const session = await service.authenticate(email, password);

      expect(session.expireIn).toBe(60 * 60 * 6);
    });

    it('should fallback to default when JWT_EXPIRES_IN is non-positive', async () => {
      process.env.JWT_EXPIRES_IN = '0';
      mockJwt.generateToken.mockReturnValue('token-zero');

      const session = await service.authenticate(email, password);

      expect(session.expireIn).toBe(60 * 60 * 6);
    });
  });

  describe('JWT errors', () => {
    beforeEach(() => {
      mockFindUnique.mockResolvedValueOnce({
        id: 1,
        email: 'a@b.c',
        password: 'hash',
        status: 'ACTIVE'
      });
      mockCompare.mockResolvedValueOnce(true);
    });

    it('should throw DomainError when JWT_SECRET_KEY is missing', async () => {
      mockJwt.generateToken.mockImplementation(() => {
        throw new Error('JWT_SECRET_KEY is not defined');
      });

      await expect(service.authenticate(email, password)).rejects.toBeInstanceOf(DomainError);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should rethrow unexpected JWT errors', async () => {
      mockJwt.generateToken.mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(service.authenticate(email, password)).rejects.toThrow('boom');
    });
  });
});
