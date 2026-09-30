import type { ZodError } from 'zod';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationErrorResponse {
  message: string;
  data: {
    errors: ValidationError[];
  };
}

export function zodValidationErrorHandler(error: ZodError): ValidationErrorResponse {
  const formattedErrors: ValidationError[] = error.issues.map(issue => ({
    field: issue.path.join('.'),
    message: issue.message
  }));

  return {
    message: 'Validation failed',
    data: {
      errors: formattedErrors
    }
  };
}
