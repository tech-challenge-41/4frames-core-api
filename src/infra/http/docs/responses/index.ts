import { BadRequest } from './bad-request';
import { NotFound } from './not-found';
import { TooManyRequests } from './too-many-requests';
import { Unauthorized } from './unauthorized';

export const responses = {
  BadRequest,
  Unauthorized,
  NotFound,
  TooManyRequests
};
