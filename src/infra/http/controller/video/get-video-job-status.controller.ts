import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import { type GetVideoJobStatusOutputDTO } from '@/application/use-case/video/get-video-job-status/get-video-job-status.dto';
import { type IUseCase } from '@/domain/ports/use-case';

import { type IController } from '../controller.inteface';

export class GetVideoJobStatusController implements IController {
  constructor(private readonly getVideoJobStatusUseCase: IUseCase<any, GetVideoJobStatusOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const { jobId } = request.params;

    if (typeof jobId !== 'string' || !/^\d+$/.test(jobId)) {
      throw new InvalidRequestParamError('jobId must be a positive integer', { jobId });
    }

    const result = await this.getVideoJobStatusUseCase.execute({
      userId,
      jobId: Number(jobId)
    });

    return response.status(200).json(result);
  }
}
