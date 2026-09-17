import { type Logger } from '@4frames/shared/logger';

import { DELETE_MESSAGE, type MessageHandler } from './message-handler';
import { parseS3EventMessage } from './s3-event';
import { type ProcessVideoJobResult } from '../processing/process-video-job.usecase';

export interface VideoUploadHandlerDependencies {
  processVideoJob: { execute(input: { key: string }): Promise<ProcessVideoJobResult> };
  bucket: string;
  logger: Logger;
}

/** Handler da fila de uploads: um evento S3 ObjectCreated por vídeo enviado. */
export function createVideoUploadHandler({
  processVideoJob,
  bucket,
  logger
}: VideoUploadHandlerDependencies): MessageHandler {
  return async message => {
    const event = parseS3EventMessage(message.Body);

    if (event.kind === 'test') {
      // Publicado pelo S3 ao configurar a notificação (a cada start do LocalStack).
      logger.debug('Ignoring s3:TestEvent', { messageId: message.MessageId });
      return DELETE_MESSAGE;
    }

    if (event.kind === 'invalid') {
      // Nunca vai ser processável: apagar evita três recebimentos inúteis até a DLQ.
      logger.error('Discarding malformed queue message', undefined, {
        messageId: message.MessageId,
        reason: event.reason
      });
      return DELETE_MESSAGE;
    }

    let retryDelaySeconds: number | undefined;

    for (const record of event.records) {
      if (!record.eventName.startsWith('ObjectCreated:') || record.bucket !== bucket) {
        logger.warn('Ignoring S3 record that is not an object created in the videos bucket', { ...record });
        continue;
      }

      const result = await processVideoJob.execute({ key: record.key });

      if (result.action === 'retry') {
        retryDelaySeconds = Math.max(retryDelaySeconds ?? 0, result.delaySeconds);
      }
    }

    return retryDelaySeconds === undefined ? DELETE_MESSAGE : { action: 'retry', delaySeconds: retryDelaySeconds };
  };
}
