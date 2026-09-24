import { JOB_EVENT_TYPES, type JobEvent } from '@4frames/shared/jobs';
import { type Request, type Response } from 'express';

import { type GetVideoJobStatusOutputDTO } from '@/application/use-case/video/get-video-job-status/get-video-job-status.dto';
import { type IJobEventSubscriber } from '@/domain/ports/service/job-event-subscriber.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';
import { parseJobIdParam } from '@/infra/http/validators/video/job-id-param.validator';

import { type IController } from '../controller.inteface';

const HEARTBEAT_INTERVAL_MS = 15_000;
const TERMINAL_EVENT_TYPES: string[] = [JOB_EVENT_TYPES.done, JOB_EVENT_TYPES.failed];

/**
 * Foge deliberadamente do padrão IController "resolve depois de escrever uma resposta": um stream SSE
 * mantém a conexão aberta e escreve várias vezes até um evento terminal ou o cliente desconectar. O
 * método ainda satisfaz a assinatura `handle(req, res): Promise<Response>` — a promise só resolve quando
 * o stream de fato termina —, então não foi necessário alterar IController nem o controllerWrapper: a
 * autorização (passo que pode lançar DomainError) roda antes de qualquer escrita, então o
 * controllerWrapper ainda traduz esse erro normalmente. Depois do primeiro `res.writeHead`, qualquer
 * falha (ex.: erro no subscriber) só pode ser tratada dentro do próprio stream, nunca via exception.
 */
export class GetVideoJobEventsController implements IController {
  constructor(
    private readonly getVideoJobStatusUseCase: IUseCase<any, GetVideoJobStatusOutputDTO>,
    private readonly jobEventSubscriber: IJobEventSubscriber
  ) {}

  public async handle(request: Request, response: Response): Promise<Response> {
    const { userId } = request.authenticated!;
    const jobId = parseJobIdParam(request.params.jobId);

    // Autorização (findById + dono) acontece ANTES de qualquer escrita SSE: um DomainError aqui ainda
    // é traduzido normalmente pelo controllerWrapper. Depois do writeHead não dá mais pra fazer isso.
    await this.getVideoJobStatusUseCase.execute({ userId, jobId });

    return this.stream(request, response, jobId, userId);
  }

  private async stream(request: Request, response: Response, jobId: string, userId: number): Promise<Response> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      // Evita que proxies reversos comuns (nginx) façam buffer da resposta e atrasem os eventos.
      'X-Accel-Buffering': 'no'
    });

    return new Promise<Response>(resolve => {
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        clearInterval(heartbeat);
        void subscriptionPromise.then(subscription => subscription?.unsubscribe());
        resolve(response);
      };

      const writeEvent = (event: JobEvent) => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);

        if (TERMINAL_EVENT_TYPES.includes(event.type)) {
          response.end();
          finish();
        }
      };

      const heartbeat = setInterval(() => {
        response.write(': heartbeat\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      request.on('close', finish);
      response.on('close', finish);

      const subscriptionPromise = this.jobEventSubscriber.subscribe(jobId, userId, writeEvent).catch(error => {
        response.write(
          `data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'subscription failed' })}\n\n`
        );
        response.end();
        finish();
        return null;
      });
    });
  }
}
