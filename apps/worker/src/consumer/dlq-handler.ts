import { type Logger } from '@4frames/shared/logger';

import { DELETE_MESSAGE, type MessageHandler } from './message-handler';
import { parseS3EventMessage } from './s3-event';
import { readRequeueCount, type UploadRequeuer } from './upload-requeuer';
import { FAILURE_REASONS } from '../processing/errors';
import { type JobEventPublisher, type VideoJobRepository } from '../processing/ports';
import { DEFAULT_UPLOAD_CONFIRMATION } from '../processing/process-video-job.usecase';
import { parseJobSourceKey } from '../processing/source-key';

/**
 * Quantas vezes a DLQ devolve à fila de uploads a mensagem de um job ainda não tentado. Cada volta dura uns 3,5 min
 * (3 recebimentos esperando o `complete`), então 3 voltas cobrem com folga a URL de upload de 5 min mais a margem e a
 * cadência da rotina de expiração. O limite só pesa sem essa rotina (overlay ci, `dev:worker` sem `expire`).
 */
export const MAX_REQUEUES = 3;

export interface DlqHandlerDependencies {
  repository: VideoJobRepository;
  publisher: JobEventPublisher;
  requeuer: UploadRequeuer;
  logger: Logger;
}

/**
 * Handler da DLQ: a mensagem esgotou os recebimentos da fila principal.
 * - Job em PROCESSING (falhas transientes ou worker derrubado várias vezes): FAILED com o motivo e o dono é notificado.
 * - Job em UPLOAD_PENDING ou QUEUED: o vídeo nunca foi tentado, porque os recebimentos se foram esperando um
 *   `complete` atrasado. A mensagem volta à fila de uploads, até `MAX_REQUEUES` vezes.
 * A mensagem da DLQ só é apagada depois do reenvio: se ele falhar, o erro devolve a mensagem à DLQ.
 */
export function createDlqHandler({ repository, publisher, requeuer, logger }: DlqHandlerDependencies): MessageHandler {
  return async message => {
    const event = parseS3EventMessage(message.Body);

    if (event.kind !== 'records') {
      logger.warn('Discarding dead-lettered message without S3 records', {
        messageId: message.MessageId,
        kind: event.kind
      });
      return DELETE_MESSAGE;
    }

    const requeueCount = readRequeueCount(message);
    let requeueDelaySeconds: number | undefined;

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

      if (job.status === 'UPLOAD_PENDING' || job.status === 'QUEUED') {
        // markProcessing nunca rodou: nenhum recebimento chegou a tentar o vídeo.
        if (requeueCount < MAX_REQUEUES) {
          // QUEUED: o complete chegou no fim da última espera e o job já pode ser processado.
          const delaySeconds = job.status === 'QUEUED' ? 0 : DEFAULT_UPLOAD_CONFIRMATION.retryDelaySeconds;
          requeueDelaySeconds = Math.min(requeueDelaySeconds ?? delaySeconds, delaySeconds);
          log.info('Dead-lettered message for a job never attempted, sending it back to the uploads queue', {
            status: job.status,
            requeueCount
          });
          continue;
        }

        if (job.status === 'UPLOAD_PENDING') {
          // Upload nunca confirmado: quem cuida é a rotina de expiração (UPLOAD_PENDING → EXPIRED).
          log.warn('Dead-lettered message for an upload that was never confirmed', { requeueCount });
          continue;
        }
      }

      if (!(await repository.markFailed(jobId, FAILURE_REASONS.retriesExhausted))) {
        log.info('Dead-lettered message for a job already in a final state', { status: job.status });
        continue;
      }

      log.error('Job failed after exhausting its retries', undefined, { previousStatus: job.status });
      await publisher.publishFailed({ jobId, userId, reason: FAILURE_REASONS.retriesExhausted });
    }

    if (requeueDelaySeconds !== undefined) {
      await requeuer.requeue(message, requeueDelaySeconds);
    }

    return DELETE_MESSAGE;
  };
}
