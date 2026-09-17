import { sign, verify, type Algorithm, type Secret } from 'jsonwebtoken';

import { type IJwt } from '@/domain/ports/service/jwt.interface';

export default class JwtSecretKeyService implements IJwt {
  protected readonly algorithm: Algorithm = 'HS256';

  constructor(protected readonly secretKey: string) {}

  public generateToken(payload: object, expiresIn: number): string {
    return sign(payload, this.secretKey as Secret, {
      algorithm: this.algorithm,
      expiresIn: `${expiresIn}s`
    });
  }

  public verifyToken(token: string): object | null {
    try {
      return verify(token, this.secretKey as Secret, {
        algorithms: [this.algorithm]
      }) as object;
    } catch {
      throw new Error('Invalid token');
    }
  }
}
