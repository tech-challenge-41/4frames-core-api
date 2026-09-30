import { type Request, type Response } from 'express';

import { type GetVideoJobDownloadUrlOutputDTO } from '@/application/use-case/video/get-video-job-download-url/get-video-job-download-url.dto';
import { type IUseCase } from '@/domain/ports/use-case';
import { parseJobIdParam } from '@/infra/http/validators/video/job-id-param.validator';

import { type IController } from '../controller.inteface';

export class GetVideoJobDownloadUrlController implements IController {
  constructor(private readonly getVideoJobDownloadUrlUseCase: IUseCase<any, GetVideoJobDownloadUrlOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const jobId = parseJobIdParam(request.params.jobId);

    const result = await this.getVideoJobDownloadUrlUseCase.execute({ userId, jobId });

    return response.status(200).json(result);
  }
}
