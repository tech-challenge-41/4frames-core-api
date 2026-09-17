import { sign, verify } from 'jsonwebtoken';

import JwtSecretKeyService from '../jwt-secret-key.service';

jest.mock('jsonwebtoken');

describe('JwtSecretKeyService', () => {
  const mockSecret = 'test-secret-key-min-32-chars!!';
  let jwt: JwtSecretKeyService;

  beforeEach(() => {
    jwt = new JwtSecretKeyService(mockSecret);
    jest.clearAllMocks();
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token with correct parameters', () => {
      const mockPayload = { userId: '123', email: 'test@example.com' };
      const mockExpiresIn = 3600;
      const mockToken = 'mock.jwt.token';

      (sign as jest.Mock).mockReturnValue(mockToken);

      const result = jwt.generateToken(mockPayload, mockExpiresIn);

      expect(sign).toHaveBeenCalledWith(mockPayload, mockSecret, {
        algorithm: 'HS256',
        expiresIn: '3600s'
      });
      expect(result).toBe(mockToken);
    });

    it('should verify and return decoded payload for valid token', () => {
      const mockToken = 'valid.jwt.token';
      const mockDecodedPayload = { userId: '123', email: 'test@example.com' };

      (verify as jest.Mock).mockReturnValue(mockDecodedPayload);

      const result = jwt.verifyToken(mockToken);

      expect(verify).toHaveBeenCalledWith(mockToken, mockSecret, {
        algorithms: ['HS256']
      });
      expect(result).toEqual(mockDecodedPayload);
    });

    it('should throw error for invalid token', () => {
      const mockToken = 'invalid.jwt.token';

      (verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      expect(() => jwt.verifyToken(mockToken)).toThrow('Invalid token');
      expect(verify).toHaveBeenCalledWith(mockToken, mockSecret, {
        algorithms: ['HS256']
      });
    });
  });

  describe('constructor', () => {
    it('should create instance with provided secret', () => {
      const customJwt = new JwtSecretKeyService('my-secret');

      expect(customJwt).toBeInstanceOf(JwtSecretKeyService);
    });
  });
});
