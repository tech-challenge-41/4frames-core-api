import { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { zodValidationErrorHandler } from '@/infra/http/utils/zod-validation-error-handler/zod-validation-error-handler';

export function validateMiddleware(schema: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errorResponse = zodValidationErrorHandler(err);
        return res.status(400).json(errorResponse);
      }

      return res.status(400).json({
        message: 'Validation failed',
        data: {}
      });
    }
  };
}
