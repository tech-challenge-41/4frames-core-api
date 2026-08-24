import { LOGGER_KEY } from '@/domain/ports/service/logger.interface';
import { appLogger } from '@/infra/logging/application-logger';
import { JwtAuthenticatorService } from '@/infra/services/jwt-authenticator.service';
import { JwtSecretKeyFactory } from '@/infra/services/jwt-secret-key.factory';
import JwtSecretKeyService from '@/infra/services/jwt-secret-key.service';
import { UserAuthenticatorService } from '@/infra/services/user-authenticator.service';

import { type Container } from './container';

export async function infraDependency(c: Container) {
  c.register(LOGGER_KEY, appLogger);
  c.register(JwtSecretKeyService.name, JwtSecretKeyFactory.create());
  c.register(UserAuthenticatorService.name, new UserAuthenticatorService({ jwt: c.resolve(JwtSecretKeyService.name) }));
  c.register(JwtAuthenticatorService.name, new JwtAuthenticatorService());
}
