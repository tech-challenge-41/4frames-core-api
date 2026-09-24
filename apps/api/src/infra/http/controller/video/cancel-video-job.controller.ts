import { type Request, type Response } from 'express';

import { type CancelVideoJobOutputDTO } from '@/application/use-case/video/cancel-video-job/cancel-video-job.dto';
import { type IUseCase } from '@/domain/ports/use-case';
import { parseJobIdParam } from '@/infra/http/validators/video/job-id-param.validator';

import { type IController } from '../controller.inteface';

export class CancelVideoJobController implements IController {
  constructor(private readonly cancelVideoJobUseCase: IUseCase<any, CancelVideoJobOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const jobId = parseJobIdParam(request.params.jobId);

    const result = await this.cancelVideoJobUseCase.execute({ userId, jobId });

    return response.status(200).json(result);
  }
}
