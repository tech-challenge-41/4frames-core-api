import { verify, type Algorithm } from 'jsonwebtoken';

import {
  type JwtAuthFailurePayload,
  type JwtAuthPayload,
  type JwtAuthReason
} from '@/infra/lib/auth/jwt-auth-payloads';

const ALGORITHM: Algorithm = 'HS256';

class JwtNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtNotConfiguredError';
  }
}

export function authenticateJwt(authorizationHeader: unknown): JwtAuthPayload {
  if (typeof authorizationHeader !== 'string' || authorizationHeader.trim() === '') {
    return failure('MISSING_AUTHORIZATION', 'Authorization header is missing');
  }

  const [, token] = authorizationHeader.split(' ');

  if (!token) {
    return failure('MISSING_TOKEN', 'Token is missing');
  }

  try {
    const secret = readSecretKey();
    const decoded = verify(token, secret, { algorithms: [ALGORITHM] }) as {
      userId?: unknown;
    };

    return {
      valid: true,
      userId: Number(decoded.userId)
    };
  } catch (error) {
    if (error instanceof JwtNotConfiguredError) {
      return failure('JWT_NOT_CONFIGURED', error.message);
    }

    return failure('INVALID_TOKEN', error instanceof Error && error.message ? error.message : 'Invalid token');
  }
}

function failure(reason: JwtAuthReason, message: string): JwtAuthFailurePayload {
  return {
    valid: false,
    reason,
    message
  };
}

function readSecretKey(): string {
  const raw = process.env.JWT_SECRET_KEY;

  if (!raw || raw.trim() === '') {
    throw new JwtNotConfiguredError('JWT_SECRET_KEY is not set');
  }

  return raw;
}
