import { JOB_EVENT_TYPES, type JobEvent } from '@4frames/shared/jobs';
import { type Request, type Response } from 'express';

import { type GetVideoJobStatusOutputDTO } from '@/application/use-case/video/get-video-job-status/get-video-job-status.dto';
import { type IJobEventSubscriber } from '@/domain/ports/service/job-event-subscriber.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';
import { type SseStreamRegistry } from '@/infra/http/shutdown/sse-stream-registry';
import { parseJobIdParam } from '@/infra/http/validators/video/job-id-param.validator';

import { type IController } from '../controller.inteface';

const HEARTBEAT_INTERVAL_MS = 15_000;
/** Espera do EventSource antes de reconectar quando a réplica encerra o stream (o padrão do navegador é ~3 s). */
export const SHUTDOWN_RECONNECT_DELAY_MS = 1_000;
const TERMINAL_EVENT_TYPES: string[] = [JOB_EVENT_TYPES.done, JOB_EVENT_TYPES.failed];

/**
 * Foge deliberadamente do padrão IController "resolve depois de escrever uma resposta": um stream SSE
 * mantém a conexão aberta e escreve várias vezes até um evento terminal ou o cliente desconectar. O
 * método ainda satisfaz a assinatura `handle(req, res): Promise<Response>` — a promise só resolve quando
 * o stream de fato termina —, então não foi necessário alterar IController nem o controllerWrapper: a
 * autorização (passo que pode lançar DomainError) roda antes de qualquer escrita, então o
 * controllerWrapper ainda traduz esse erro normalmente. Depois do primeiro `res.writeHead`, qualquer
 * falha (ex.: erro no subscriber) só pode ser tratada dentro do próprio stream, nunca via exception.
 *
 * Cada stream aberto entra no SseStreamRegistry. No encerramento da réplica (SIGTERM), o registro termina o
 * stream com um `retry` curto, e o EventSource reconecta numa réplica que continua no ar.
 */
export class GetVideoJobEventsController implements IController {
  constructor(
    private readonly getVideoJobStatusUseCase: IUseCase<any, GetVideoJobStatusOutputDTO>,
    private readonly jobEventSubscriber: IJobEventSubscriber,
    private readonly sseStreams: SseStreamRegistry
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
    // O Node só enviaria os headers no primeiro write. Sem progresso guardado, isso seria o heartbeat, 15 s
    // depois, e até lá o EventSource não abre.
    response.flushHeaders();

    return new Promise<Response>(resolve => {
      let finished: Promise<void> | null = null;
      let unregister: () => void = () => undefined;

      // Idempotente. A promise devolvida resolve quando a conexão Redis da assinatura foi fechada.
      const finish = (): Promise<void> => {
        if (!finished) {
          clearInterval(heartbeat);
          unregister();
          resolve(response);
          finished = subscriptionPromise.then(subscription => subscription?.unsubscribe());
        }

        return finished;
      };

      const writeEvent = (event: JobEvent) => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);

        if (TERMINAL_EVENT_TYPES.includes(event.type)) {
          response.end();
          void finish();
        }
      };

      const heartbeat = setInterval(() => {
        response.write(': heartbeat\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      request.on('close', () => void finish());
      response.on('close', () => void finish());

      const subscriptionPromise = this.jobEventSubscriber.subscribe(jobId, userId, writeEvent).catch(error => {
        response.write(
          `data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'subscription failed' })}\n\n`
        );
        response.end();
        void finish();
        return null;
      });

      // Encerramento da réplica: um stream que termina sem evento terminal faz o EventSource reconectar, e o
      // `retry` encurta a espera. O stream novo cai numa réplica que continua no ar.
      unregister = this.sseStreams.register(() => {
        const closed = finish();
        response.write(`retry: ${SHUTDOWN_RECONNECT_DELAY_MS}\n\n`);
        response.end();
        return closed;
      });
    });
  }
}
