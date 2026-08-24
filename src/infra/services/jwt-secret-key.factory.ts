import { type IJwt } from '@/domain/ports/service/jwt.interface';

import JwtSecretKeyService from './jwt-secret-key.service';

export class JwtSecretKeyFactory {
  public static create(): IJwt {
    const secretKey = process.env.JWT_SECRET_KEY?.trim();

    if (!secretKey) {
      throw new Error('JWT_SECRET_KEY is not set');
    }

    return new JwtSecretKeyService(secretKey);
  }
}
