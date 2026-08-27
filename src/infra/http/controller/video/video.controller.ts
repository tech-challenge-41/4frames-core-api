import { type Request, type Response } from 'express';

import { type CreateVideoJobOutputDTO } from '@/application/use-case/video/create-video-job/create-video-job.dto';
import { type IUseCase } from '@/domain/ports/use-case';

import { type IController } from '../controller.inteface';

export class VideoController implements IController {
  constructor(private readonly createVideoJobUseCase: IUseCase<any, CreateVideoJobOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const { fileName, fileSize, contentType } = request.body;

    const result = await this.createVideoJobUseCase.execute({
      userId,
      fileName,
      fileSize,
      contentType
    });

    return response.status(201).json(result);
  }
}
