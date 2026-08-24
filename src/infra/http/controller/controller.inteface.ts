import { type Request, type Response } from 'express';

export interface IController {
  handle(request: Request, response: Response): Promise<Response>;
}
