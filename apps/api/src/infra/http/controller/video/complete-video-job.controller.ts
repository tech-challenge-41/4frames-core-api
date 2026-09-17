import { type Request, type Response } from 'express';

import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';
import { type CompleteVideoJobOutputDTO } from '@/application/use-case/video/complete-video-job/complete-video-job.dto';
import { type IUseCase } from '@/domain/ports/use-case';

import { type IController } from '../controller.inteface';

export class CompleteVideoJobController implements IController {
  constructor(private readonly completeVideoJobUseCase: IUseCase<any, CompleteVideoJobOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const { jobId } = request.params;

    if (typeof jobId !== 'string' || !/^\d+$/.test(jobId)) {
      throw new InvalidRequestParamError('jobId must be a positive integer', { jobId });
    }

    const result = await this.completeVideoJobUseCase.execute({
      userId,
      jobId: Number(jobId)
    });

    return response.status(200).json(result);
  }
}
