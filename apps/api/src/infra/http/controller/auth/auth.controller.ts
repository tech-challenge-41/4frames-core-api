import { type Request, type Response } from 'express';

import { type AuthenticateUserOutputDTO } from '@/application/use-case/user/authenticate-user/authenticate-user.dto';
import { type IUseCase } from '@/domain/ports/use-case';

import { type IController } from '../controller.inteface';

export class AuthController implements IController {
  constructor(private readonly validateUserUseCase: IUseCase<any, AuthenticateUserOutputDTO>) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { email, password } = request.body;

    const result = await this.validateUserUseCase.execute({ email, password });

    return response.status(201).json(result);
  }
}
