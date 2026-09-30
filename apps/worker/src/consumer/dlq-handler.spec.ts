import { type Message } from '@aws-sdk/client-sqs';

import { createDlqHandler, MAX_REQUEUES } from './dlq-handler';
import { REQUEUE_COUNT_ATTRIBUTE, type UploadRequeuer } from './upload-requeuer';
import { createFakeLogger, createFakeMonitoring, JOB_ID, s3EventBody, SOURCE_KEY, USER_ID } from '../__tests__/fakes';
import { FAILURE_REASONS } from '../processing/errors';
import { type JobEventPublisher, type VideoJobRepository } from '../processing/ports';

function message(body: string, requeueCount?: number): Message {
  return {
    MessageId: 'dlq-1',
    ReceiptHandle: 'receipt-1',
    Body: body,
    ...(requeueCount === undefined
      ? {}
      : { MessageAttributes: { [REQUEUE_COUNT_ATTRIBUTE]: { DataType: 'Number', StringValue: String(requeueCount) } } })
  };
}

describe('createDlqHandler', () => {
  let repository: jest.Mocked<VideoJobRepository>;
  let publisher: jest.Mocked<JobEventPublisher>;
  let requeuer: jest.Mocked<UploadRequeuer>;
  let monitoring: ReturnType<typeof createFakeMonitoring>;
  let handler: ReturnType<typeof createDlqHandler>;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'PROCESSING' }),
      markProcessing: jest.fn(),
      markDone: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(true)
    };
    publisher = { createProgressReporter: jest.fn(), publishDone: jest.fn(), publishFailed: jest.fn() };
    requeuer = { requeue: jest.fn().mockResolvedValue(undefined) };
    monitoring = createFakeMonitoring();
    handler = createDlqHandler({ repository, publisher, requeuer, logger: createFakeLogger(), monitoring });
  });

  it('should mark the job FAILED after the retries, publish job.failed and delete the message', async () => {
    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'delete' });

    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, 'Falha após 3 tentativas');
    expect(publisher.publishFailed).toHaveBeenCalledWith({
      jobId: JOB_ID,
      userId: USER_ID,
      reason: FAILURE_REASONS.retriesExhausted
    });
    expect(monitoring.incrementVideoJobsFailed).toHaveBeenCalledWith('retries_exhausted');
    expect(requeuer.requeue).not.toHaveBeenCalled();
  });

  it('should not publish when the job is already in a final state', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'DONE' });
    repository.markFailed.mockResolvedValue(false);

    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'delete' });
    expect(publisher.publishFailed).not.toHaveBeenCalled();
    expect(monitoring.incrementVideoJobsFailed).not.toHaveBeenCalled();
  });

  it('should send an unconfirmed upload back to the uploads queue with the confirmation delay', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'UPLOAD_PENDING' });
    const dead = message(s3EventBody(SOURCE_KEY));

    await expect(handler(dead)).resolves.toEqual({ action: 'delete' });

    expect(requeuer.requeue).toHaveBeenCalledWith(dead, 30);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('should send a job confirmed after the last wait back to the uploads queue without delay', async () => {
    // O complete chegou entre o último recebimento e a DLQ: QUEUED, mas o vídeo nunca foi tentado.
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'QUEUED' });
    const dead = message(s3EventBody(SOURCE_KEY), 1);

    await expect(handler(dead)).resolves.toEqual({ action: 'delete' });

    expect(requeuer.requeue).toHaveBeenCalledWith(dead, 0);
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(publisher.publishFailed).not.toHaveBeenCalled();
  });

  it('should leave never-confirmed uploads to the expiration routine once the requeue limit is reached', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'UPLOAD_PENDING' });

    await expect(handler(message(s3EventBody(SOURCE_KEY), MAX_REQUEUES))).resolves.toEqual({ action: 'delete' });

    expect(requeuer.requeue).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('should mark a QUEUED job FAILED once the requeue limit is reached', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'QUEUED' });

    await expect(handler(message(s3EventBody(SOURCE_KEY), MAX_REQUEUES))).resolves.toEqual({ action: 'delete' });

    expect(requeuer.requeue).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, FAILURE_REASONS.retriesExhausted);
    expect(publisher.publishFailed).toHaveBeenCalled();
  });

  it('should keep the message in the DLQ when sending it back fails', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'UPLOAD_PENDING' });
    requeuer.requeue.mockRejectedValue(new Error('SQS unavailable'));

    // O erro faz o consumer devolver a mensagem à DLQ em vez de apagá-la.
    await expect(handler(message(s3EventBody(SOURCE_KEY)))).rejects.toThrow('SQS unavailable');
  });

  it('should delete test events, malformed bodies, unknown keys and missing jobs without side effects', async () => {
    repository.findById.mockResolvedValue(null);

    for (const body of [
      JSON.stringify({ Event: 's3:TestEvent' }),
      'not json',
      s3EventBody('videos/1/not-a-uuid/source.mp4'),
      s3EventBody(SOURCE_KEY)
    ]) {
      await expect(handler(message(body))).resolves.toEqual({ action: 'delete' });
    }

    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(publisher.publishFailed).not.toHaveBeenCalled();
    expect(requeuer.requeue).not.toHaveBeenCalled();
  });
});
