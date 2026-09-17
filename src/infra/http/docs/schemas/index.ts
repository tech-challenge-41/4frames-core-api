import { z } from 'zod';

import { ErrorSchema } from './error.schema';
import authUserSchema from '../../validators/auth/auth-user.validator';
import createVideoJobSchema from '../../validators/video/create-video-job.validator';

const target = 'openapi-3.0';

export const schemas = {
  AuthUser: z.toJSONSchema(authUserSchema, { target }),
  CreateVideoJob: z.toJSONSchema(createVideoJobSchema, { target }),
  ErrorSchema
};
