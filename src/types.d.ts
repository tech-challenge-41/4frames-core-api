import { type Request as ExpressRequest } from 'express';

declare module 'express' {
  interface Request extends ExpressRequest {
    authenticated?: {
      userId: number;
    };
  }
}
