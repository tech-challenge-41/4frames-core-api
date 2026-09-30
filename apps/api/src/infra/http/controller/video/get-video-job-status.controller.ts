import { type Request, type Response } from 'express';

import { type GetVideoJobStatusOutputDTO } from '@/application/use-case/video/get-video-job-status/get-video-job-status.dto';
import { type IUseCase } from '@/domain/ports/use-case';
import { parseJobIdParam } from '@/infra/http/validators/video/job-id-param.validator';

import { type IController } from '../controller.inteface';

export class GetVideoJobStatusController implements IController {
  constructor(private readonly getVideoJobStatusUseCase: IUseCase<any, GetVideoJobStatusOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const jobId = parseJobIdParam(request.params.jobId);

    const result = await this.getVideoJobStatusUseCase.execute({ userId, jobId });

    return response.status(200).json(result);
  }
}
