import { type Message, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

/** Atributo da mensagem com quantas vezes a DLQ já a devolveu à fila de uploads. Ausente no evento original do S3. */
export const REQUEUE_COUNT_ATTRIBUTE = 'requeue-count';

/** Quantas vezes a mensagem já voltou da DLQ para a fila de uploads (0 no evento original do S3). */
export function readRequeueCount(message: Message): number {
  const count = Number(message.MessageAttributes?.[REQUEUE_COUNT_ATTRIBUTE]?.StringValue ?? 0);

  return Number.isInteger(count) && count > 0 ? count : 0;
}

export interface UploadRequeuer {
  /** Publica de novo o corpo da mensagem na fila de uploads, como mensagem nova, com o contador incrementado. */
  requeue(message: Message, delaySeconds: number): Promise<void>;
}

export interface SqsUploadRequeuerDependencies {
  sqs: Pick<SQSClient, 'send'>;
  queueUrl: string;
}

/**
 * Devolve à fila de uploads uma mensagem que chegou à DLQ sem o vídeo ter sido tentado. É uma mensagem nova: o
 * contador de recebimentos do SQS recomeça, e o job ganha as mesmas 3 tentativas de uma mensagem original.
 */
export class SqsUploadRequeuer implements UploadRequeuer {
  private readonly sqs: Pick<SQSClient, 'send'>;
  private readonly queueUrl: string;

  constructor({ sqs, queueUrl }: SqsUploadRequeuerDependencies) {
    this.sqs = sqs;
    this.queueUrl = queueUrl;
  }

  public async requeue(message: Message, delaySeconds: number): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: message.Body,
        DelaySeconds: delaySeconds,
        MessageAttributes: {
          [REQUEUE_COUNT_ATTRIBUTE]: { DataType: 'Number', StringValue: String(readRequeueCount(message) + 1) }
        }
      })
    );
  }
}
