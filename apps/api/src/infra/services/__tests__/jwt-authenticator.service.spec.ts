import { sign } from 'jsonwebtoken';

import { AuthError } from '@/application/error/auth-error';
import { DomainErrorTypes } from '@/domain/error/error-types';

import { JwtAuthenticatorService } from '../jwt-authenticator.service';

const SECRET = 'local-jwt-secret';

describe('JwtAuthenticatorService', () => {
  const previousKey = process.env.JWT_SECRET_KEY;

  beforeEach(() => {
    process.env.JWT_SECRET_KEY = SECRET;
  });

  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.JWT_SECRET_KEY;
    } else {
      process.env.JWT_SECRET_KEY = previousKey;
    }
  });

  it('should return userId for a valid bearer token', async () => {
    const token = sign({ userId: 7 }, SECRET, {
      algorithm: 'HS256',
      expiresIn: '3600s'
    });
    const service = new JwtAuthenticatorService();

    await expect(service.verifyAuthorizationHeader(`Bearer ${token}`)).resolves.toEqual({ userId: 7 });
  });

  it('should throw AuthError when authorization header is missing', async () => {
    const service = new JwtAuthenticatorService();

    await expect(service.verifyAuthorizationHeader(undefined)).rejects.toBeInstanceOf(AuthError);
  });

  it('should throw precondition failed when JWT secret is missing', async () => {
    delete process.env.JWT_SECRET_KEY;
    const service = new JwtAuthenticatorService();

    await expect(service.verifyAuthorizationHeader('Bearer token')).rejects.toMatchObject({
      type: DomainErrorTypes.PRECONDITION_FAILED
    });
  });
});
