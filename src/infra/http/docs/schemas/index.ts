import { z } from 'zod';

import { ErrorSchema } from './error.schema';
import authUserSchema from '../../validators/auth/auth-user.validator';

const target = 'openapi-3.0';

export const schemas = {
  AuthUser: z.toJSONSchema(authUserSchema, { target }),
  ErrorSchema
};
