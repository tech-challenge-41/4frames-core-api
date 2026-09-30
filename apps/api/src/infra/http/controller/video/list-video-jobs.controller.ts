import { type Request, type Response } from 'express';

import { type ListVideoJobsOutputDTO } from '@/application/use-case/video/list-video-jobs/list-video-jobs.dto';
import { type IUseCase } from '@/domain/ports/use-case';
import { parseListVideoJobsQuery } from '@/infra/http/validators/video/list-video-jobs.validator';

import { type IController } from '../controller.inteface';

export class ListVideoJobsController implements IController {
  constructor(private readonly listVideoJobsUseCase: IUseCase<any, ListVideoJobsOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const { limit, offset } = parseListVideoJobsQuery(request.query);

    const result = await this.listVideoJobsUseCase.execute({ userId, limit, offset });

    return response.status(200).json(result);
  }
}
