import { ApplicationError } from './application-error';

export class InvalidRequestParamError extends ApplicationError {
  constructor(message: string = 'Invalid request parameter', data?: any) {
    super({ message, data, status: 400 });
  }
}
