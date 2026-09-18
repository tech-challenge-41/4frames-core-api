import { type Logger } from '@4frames/shared/logger';

import { DELETE_MESSAGE, type MessageHandler } from './message-handler';
import { parseS3EventMessage } from './s3-event';
import { FAILURE_REASONS } from '../processing/errors';
import { type JobEventPublisher, type VideoJobRepository } from '../processing/ports';
import { parseJobSourceKey } from '../processing/source-key';

export interface DlqHandlerDependencies {
  repository: VideoJobRepository;
  publisher: JobEventPublisher;
  logger: Logger;
}

/**
 * Handler da DLQ: a mensagem esgotou as tentativas da fila principal (falhas transientes ou worker
 * derrubado várias vezes). O job vai para FAILED com o motivo, o dono é notificado e a mensagem é apagada.
 */
export function createDlqHandler({ repository, publisher, logger }: DlqHandlerDependencies): MessageHandler {
  return async message => {
    const event = parseS3EventMessage(message.Body);

    if (event.kind !== 'records') {
      logger.warn('Discarding dead-lettered message without S3 records', {
        messageId: message.MessageId,
        kind: event.kind
      });
      return DELETE_MESSAGE;
    }

    for (const record of event.records) {
      const source = parseJobSourceKey(record.key);

      if (!source) {
        logger.warn('Discarding dead-lettered record with an unknown key', { key: record.key });
        continue;
      }

      const { jobId, userId } = source;
      const log = logger.child({ jobId, userId });
      const job = await repository.findById(jobId);

      if (!job || job.userId !== userId) {
        log.warn('Dead-lettered message for a job that does not exist');
        continue;
      }

      if (job.status === 'UPLOAD_PENDING') {
        // Upload nunca confirmado: quem cuida é a rotina de expiração (UPLOAD_PENDING → EXPIRED).
        log.warn('Dead-lettered message for an upload that was never confirmed');
        continue;
      }

      if (!(await repository.markFailed(jobId, FAILURE_REASONS.retriesExhausted))) {
        log.info('Dead-lettered message for a job already in a final state', { status: job.status });
        continue;
      }

      log.error('Job failed after exhausting its retries', undefined, { previousStatus: job.status });
      await publisher.publishFailed({ jobId, userId, reason: FAILURE_REASONS.retriesExhausted });
    }

    return DELETE_MESSAGE;
  };
}
