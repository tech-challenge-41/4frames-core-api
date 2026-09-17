import bcrypt from 'bcrypt';

import { AuthError } from '@/application/error/auth-error';
import { DomainError } from '@/domain/error/domain-error';
import { DomainErrorTypes } from '@/domain/error/error-types';
import { type IJwt } from '@/domain/ports/service/jwt.interface';
import {
  type AuthenticatedUserSession,
  type IUserAuthenticatorService
} from '@/domain/ports/service/user-authenticator.service.interface';
import { prisma } from '@/infra/db/core/prisma/client';
import { type UserAuthPayload } from '@/infra/lib/auth/user-auth-payloads';

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 30;
const DEFAULT_JWT_EXPIRES_IN_SECONDS = 60 * 60 * 6;

interface UserAuthenticatorServiceConfig {
  jwt: IJwt;
}

export class UserAuthenticatorService implements IUserAuthenticatorService {
  private readonly jwt: IJwt;

  constructor({ jwt }: UserAuthenticatorServiceConfig) {
    this.jwt = jwt;
  }

  public async authenticate(email: string, password: string): Promise<AuthenticatedUserSession> {
    const payload = await this.buildAuthPayload(email, password);

    if (payload.authenticated) {
      return this.toSession(payload);
    }

    if (payload.reason === 'JWT_NOT_CONFIGURED') {
      this.throwUnavailableError('User authenticator JWT is not configured', { reason: payload.reason });
    }

    throw new AuthError('Incorrect email or password', {
      reason: payload.reason,
      email: payload.email
    });
  }

  private async buildAuthPayload(email: string, password: string): Promise<UserAuthPayload> {
    if (typeof email !== 'string' || email.trim() === '') {
      return {
        authenticated: false,
        reason: 'EMAIL_INVALID_PAYLOAD'
      };
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (typeof password !== 'string') {
      return {
        authenticated: false,
        reason: 'PASSWORD_INVALID_PAYLOAD',
        email: normalizedEmail
      };
    }

    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return {
        authenticated: false,
        reason: 'INVALID_PASSWORD_LENGTH',
        email: normalizedEmail
      };
    }

    const user = await prisma.users.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      return {
        authenticated: false,
        reason: 'INVALID_CREDENTIALS',
        email: normalizedEmail
      };
    }

    if (user.status !== 'ACTIVE') {
      return {
        authenticated: false,
        reason: 'USER_INACTIVE',
        email: normalizedEmail
      };
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return {
        authenticated: false,
        reason: 'INVALID_CREDENTIALS',
        email: normalizedEmail
      };
    }

    try {
      const expireIn = readJwtExpiresInSeconds();
      const accessToken = this.jwt.generateToken({ userId: user.id }, expireIn);

      return {
        authenticated: true,
        accessToken,
        expireIn,
        user: {
          id: user.id,
          email: user.email
        }
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('JWT_SECRET_KEY')) {
        return {
          authenticated: false,
          reason: 'JWT_NOT_CONFIGURED',
          email: normalizedEmail
        };
      }

      throw error;
    }
  }

  private toSession(payload: Extract<UserAuthPayload, { authenticated: true }>): AuthenticatedUserSession {
    return {
      accessToken: payload.accessToken,
      expireIn: payload.expireIn,
      user: {
        id: payload.user.id,
        email: payload.user.email
      }
    };
  }

  private throwUnavailableError(message: string, logDetail?: unknown): never {
    if (logDetail !== undefined) {
      console.error(`[${UserAuthenticatorService.name}] ${message}`, logDetail);
    }

    throw new DomainError({
      message,
      type: DomainErrorTypes.PRECONDITION_FAILED,
      context: UserAuthenticatorService.name,
      data: {
        ...(logDetail ? { logDetail } : {})
      }
    });
  }
}

function readJwtExpiresInSeconds(): number {
  const raw = process.env.JWT_EXPIRES_IN?.trim();

  if (!raw) {
    return DEFAULT_JWT_EXPIRES_IN_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_JWT_EXPIRES_IN_SECONDS;
  }

  return parsed;
}
