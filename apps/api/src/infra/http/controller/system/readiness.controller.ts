import { type Request, type Response } from 'express';

import { type CheckReadinessOutputDTO } from '@/application/use-case/system/check-readiness/check-readiness.dto';
import { type IUseCase } from '@/domain/ports/use-case';

import { type IController } from '../controller.inteface';

/** `GET /ready`: 200 com todas as dependências respondendo, 503 se alguma falhar. É a readiness probe da API. */
export class ReadinessController implements IController {
  constructor(private readonly checkReadinessUseCase: IUseCase<void, CheckReadinessOutputDTO>) {}

  public async handle(_request: Request, response: Response): Promise<Response> {
    const { ready, checks } = await this.checkReadinessUseCase.execute();

    return response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', checks });
  }
}
