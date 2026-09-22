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
  /**
   * Quantos handlers rodam em paralelo no event loop (Promises). Cada um mantém seu heartbeat SQS.
   * Limite de 10 por chamada ReceiveMessage (máximo da API).
   */
  maxParallelJobs?: number;
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
 * Laço de consumo de uma fila SQS com paralelismo configurável (async no Node, sem threads):
 * - long polling (`WaitTimeSeconds`), até `maxParallelJobs` mensagens em processamento;
 * - heartbeat com `ChangeMessageVisibility` por mensagem em andamento;
 * - `delete` apaga; `retry` e erro transiente devolvem a mensagem à fila com atraso (após 3 recebimentos, DLQ);
 * - `stop()` interrompe o long polling, espera todos os jobs em andamento e resolve (SIGTERM do scale-down).
 */
export class SqsConsumer {
  private readonly sqs: Pick<SQSClient, 'send'>;
  private readonly queueUrl: string;
  private readonly handler: MessageHandler;
  private readonly logger: Logger;
  private readonly visibilityTimeoutSeconds: number;
  private readonly maxParallelJobs: number;
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
  private inFlight = 0;
  private readonly inFlightTasks = new Set<Promise<void>>();

  constructor(options: SqsConsumerOptions) {
    this.sqs = options.sqs;
    this.queueUrl = options.queueUrl;
    this.handler = options.handler;
    this.logger = options.logger.child({ consumer: options.name });
    this.visibilityTimeoutSeconds = options.visibilityTimeoutSeconds;
    this.maxParallelJobs = options.maxParallelJobs ?? 1;
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

  /** Para de receber, espera os jobs em andamento terminarem e resolve. */
  public async stop(): Promise<void> {
    if (!this.loop) {
      return;
    }

    if (!this.stopping) {
      this.logger.info('Stopping consumer, waiting for in-flight messages to finish', {
        inFlight: this.inFlight
      });
    }

    this.stopping = true;
    this.pollAbort?.abort();
    this.wakeUp?.();

    await this.loop;
  }

  /**
   * Laço rodando e com sinal recente (última volta do long polling ou job em andamento).
   * Continua true durante o encerramento, enquanto jobs atuais terminam: a probe não pode matar o pod no meio deles.
   */
  public isAlive(): boolean {
    return this.loop !== undefined && !this.finished && this.now() - this.lastAliveAt <= this.maxSilenceMs;
  }

  private markAlive(): void {
    this.lastAliveAt = this.now();
  }

  private trackInFlight(task: Promise<void>): void {
    this.inFlight += 1;
    this.inFlightTasks.add(task);

    void task.finally(() => {
      this.inFlight -= 1;
      this.inFlightTasks.delete(task);
      this.markAlive();
    });
  }

  private async waitForCapacity(): Promise<void> {
    if (this.inFlightTasks.size === 0) {
      return;
    }

    await Promise.race(this.inFlightTasks);
  }

  private async run(): Promise<void> {
    this.logger.info('Consumer started', { queueUrl: this.queueUrl, maxParallelJobs: this.maxParallelJobs });

    try {
      while (!this.stopping) {
        this.markAlive();

        while (!this.stopping && this.inFlight < this.maxParallelJobs) {
          const slots = this.maxParallelJobs - this.inFlight;
          const messages = await this.receive(Math.min(slots, 10));

          if (messages.length === 0) {
            if (this.inFlight > 0) {
              await this.waitForCapacity();
            }

            break;
          }

          for (const message of messages) {
            if (this.stopping) {
              await this.changeVisibility(message, 0);
              continue;
            }

            if (this.inFlight >= this.maxParallelJobs) {
              break;
            }

            this.trackInFlight(this.processMessage(message));
          }
        }

        if (!this.stopping && this.inFlight >= this.maxParallelJobs) {
          await this.waitForCapacity();
        }
      }
    } catch (error) {
      this.logger.error('Consumer loop crashed', toError(error));
      throw error;
    } finally {
      await Promise.all(this.inFlightTasks);
      this.finished = true;
    }

    this.logger.info('Consumer stopped');
  }

  private async receive(maxMessages: number): Promise<Message[]> {
    const abort = new AbortController();
    this.pollAbort = abort;

    try {
      const output = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: Math.max(1, Math.min(maxMessages, 10)),
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
