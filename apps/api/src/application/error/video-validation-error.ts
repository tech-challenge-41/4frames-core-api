import { ApplicationError } from './application-error';

export class VideoValidationError extends ApplicationError {
  constructor(message: string = 'Invalid video upload request', data?: any) {
    super({ message, data, status: 422 });
  }
}
