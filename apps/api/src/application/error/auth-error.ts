import { ApplicationError } from './application-error';

export class AuthError extends ApplicationError {
  constructor(message: string = 'Authentication failed', data?: any) {
    super({ message, data, status: 401 });
  }
}
