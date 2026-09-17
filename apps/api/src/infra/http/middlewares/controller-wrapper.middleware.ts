import { type Request, type Response } from 'express';

import { Container } from '@/dependencies/container';

import { type IController } from '../controller/controller.inteface';
import { httpErrorHandler } from '../utils/http-error-handler/http-error-handler';

export function controllerWrapper(controllerName: string) {
  return async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const container = Container.getInstance();
      const resolvedController = container.resolve<IController>(controllerName);

      return await resolvedController.handle(req, res);
    } catch (error: unknown) {
      const { status, message, data } = httpErrorHandler(error as Error);
      return res.status(status).json({ message, data });
    }
  };
}
