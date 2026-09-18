import { type Logger } from '@4frames/shared/logger';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  type SQSClient
} from '@aws-sdk/client-sqs';

import { type MessageHandler } from './message-handler';
import { toError } from '../processing/errors';

export interface SqsConsumerOptions {
  /** Nome curto para logs (ex.: `uploads`, `dlq`). */
  name: string;
  sqs: Pick<SQSClient, 'send'>;
  queueUrl: string;
  handler: MessageHandler;
  logger: Logger;
  /** Pedido em cada ReceiveMessage e renovado na metade do tempo enquanto o handler roda. */
  visibilityTimeoutSeconds: number;
  waitTimeSeconds?: number;
  /** Atraso até a mensagem voltar a ficar visível depois de uma falha transiente. */
  transientRetryDelaySeconds?: number;
  /** Pausa depois de um erro no ReceiveMessage (SQS fora do ar). */
  receiveErrorBackoffMs?: number;
  /** De quanto em quanto tempo o consumer sinaliza que está vivo enquanto um job longo roda. */
  livenessIntervalMs?: number;
  /** Sem sinal por mais que isso, `isAlive()` devolve false (liveness probe). */
  maxSilenceMs?: number;
  now?: () => number;
}

/**
 * Laço de consumo de uma fila SQS, uma mensagem por vez:
 * - long polling (`WaitTimeSeconds`), `MaxNumberOfMessages=1`: um vídeo por worker, e o KEDA escala réplicas;
 * - heartbeat com `ChangeMessageVisibility` enquanto o handler roda, para a mensagem não reaparecer;
 * - `delete` apaga; `retry` e erro transiente devolvem a mensagem à fila com atraso (após 3 recebimentos, DLQ);
 * - `stop()` interrompe o long polling, espera a mensagem atual terminar e resolve (SIGTERM do scale-down).
 */
export class SqsConsumer {
  private readonly sqs: Pick<SQSClient, 'send'>;
  private readonly queueUrl: string;
  private readonly handler: MessageHandler;
  private readonly logger: Logger;
  private readonly visibilityTimeoutSeconds: number;
  private readonly waitTimeSeconds: number;
  private readonly transientRetryDelaySeconds: number;
  private readonly receiveErrorBackoffMs: number;
  private readonly livenessIntervalMs: number;
  private readonly maxSilenceMs: number;
  private readonly now: () => number;

  private loop?: Promise<void>;
  private stopping = false;
  private finished = false;
  private pollAbort?: AbortController;
  private wakeUp?: () => void;
  private lastAliveAt: number;

  constructor(options: SqsConsumerOptions) {
    this.sqs = options.sqs;
    this.queueUrl = options.queueUrl;
    this.handler = options.handler;
    this.logger = options.logger.child({ consumer: options.name });
    this.visibilityTimeoutSeconds = options.visibilityTimeoutSeconds;
    this.waitTimeSeconds = options.waitTimeSeconds ?? 20;
    this.transientRetryDelaySeconds = options.transientRetryDelaySeconds ?? 60;
    this.receiveErrorBackoffMs = options.receiveErrorBackoffMs ?? 5000;
    this.livenessIntervalMs = options.livenessIntervalMs ?? 10_000;
    this.maxSilenceMs = options.maxSilenceMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.lastAliveAt = this.now();
  }

  /** Inicia o laço. A promise resolve quando o consumer para e rejeita só em erro inesperado. */
  public start(): Promise<void> {
    this.loop ??= this.run();

    return this.loop;
  }

  /** Para de receber, espera a mensagem em andamento terminar e resolve. */
  public async stop(): Promise<void> {
    if (!this.loop) {
      return;
    }

    if (!this.stopping) {
      this.logger.info('Stopping consumer, waiting for the current message to finish');
    }

    this.stopping = true;
    this.pollAbort?.abort();
    this.wakeUp?.();

    await this.loop;
  }

  /**
   * Laço rodando e com sinal recente (última volta do long polling ou job em andamento).
   * Continua true durante o encerramento, enquanto o job atual termina: a probe não pode matar o pod no meio dele.
   */
  public isAlive(): boolean {
    return this.loop !== undefined && !this.finished && this.now() - this.lastAliveAt <= this.maxSilenceMs;
  }

  private markAlive(): void {
    this.lastAliveAt = this.now();
  }

  private async run(): Promise<void> {
    this.logger.info('Consumer started', { queueUrl: this.queueUrl });

    try {
      while (!this.stopping) {
        this.markAlive();
        const messages = await this.receive();

        for (const message of messages) {
          if (this.stopping) {
            // Recebida durante o encerramento: devolve na hora para outra réplica.
            await this.changeVisibility(message, 0);
            continue;
          }

          await this.processMessage(message);
        }
      }
    } catch (error) {
      this.logger.error('Consumer loop crashed', toError(error));
      throw error;
    } finally {
      this.finished = true;
    }

    this.logger.info('Consumer stopped');
  }

  private async receive(): Promise<Message[]> {
    const abort = new AbortController();
    this.pollAbort = abort;

    try {
      const output = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: this.waitTimeSeconds,
          VisibilityTimeout: this.visibilityTimeoutSeconds,
          MessageSystemAttributeNames: ['ApproximateReceiveCount']
        }),
        { abortSignal: abort.signal }
      );

      return output.Messages ?? [];
    } catch (error) {
      if (this.stopping) {
        return [];
      }

      this.logger.error('Failed to receive messages', toError(error), { retryInMs: this.receiveErrorBackoffMs });
      await this.pause(this.receiveErrorBackoffMs);

      return [];
    } finally {
      this.pollAbort = undefined;
    }
  }

  private async processMessage(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      this.logger.warn('Received a message without receipt handle', { messageId: message.MessageId });
      return;
    }

    const log = this.logger.child({
      messageId: message.MessageId,
      receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? 1)
    });

    const visibilityHeartbeat = setInterval(
      () => void this.changeVisibility(message, this.visibilityTimeoutSeconds, log),
      (this.visibilityTimeoutSeconds * 1000) / 2
    );
    const livenessHeartbeat = setInterval(() => this.markAlive(), this.livenessIntervalMs);

    try {
      const result = await this.handler(message);

      if (result.action === 'delete') {
        await this.deleteMessage(message, log);
      } else {
        await this.changeVisibility(message, result.delaySeconds, log);
      }
    } catch (error) {
      log.error('Message processing failed, it will be retried', toError(error), {
        retryInSeconds: this.transientRetryDelaySeconds
      });
      await this.changeVisibility(message, this.transientRetryDelaySeconds, log);
    } finally {
      clearInterval(visibilityHeartbeat);
      clearInterval(livenessHeartbeat);
      this.markAlive();
    }
  }

  private async deleteMessage(message: Message, log: Logger): Promise<void> {
    try {
      await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
    } catch (error) {
      // A mensagem vai reaparecer; o job já está em estado final e será descartado.
      log.error('Failed to delete message', toError(error));
    }
  }

  private async changeVisibility(message: Message, seconds: number, log: Logger = this.logger): Promise<void> {
    try {
      await this.sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: seconds
        })
      );
    } catch (error) {
      log.warn('Failed to change message visibility', { seconds, error: toError(error).message });
    }
  }

  /** Espera `ms`, ou menos se `stop()` for chamado. */
  private pause(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);

      this.wakeUp = done;
    }).finally(() => {
      this.wakeUp = undefined;
    });
  }
}
