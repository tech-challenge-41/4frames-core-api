import { type Request, type Response } from 'express';

import { type CompleteVideoJobOutputDTO } from '@/application/use-case/video/complete-video-job/complete-video-job.dto';
import { type IUseCase } from '@/domain/ports/use-case';
import { parseJobIdParam } from '@/infra/http/validators/video/job-id-param.validator';

import { type IController } from '../controller.inteface';

export class CompleteVideoJobController implements IController {
  constructor(private readonly completeVideoJobUseCase: IUseCase<any, CompleteVideoJobOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const jobId = parseJobIdParam(request.params.jobId);

    const result = await this.completeVideoJobUseCase.execute({ userId, jobId });

    return response.status(200).json(result);
  }
}
