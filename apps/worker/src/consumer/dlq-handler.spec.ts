import { type Message } from '@aws-sdk/client-sqs';

import { createDlqHandler } from './dlq-handler';
import { createFakeLogger, JOB_ID, s3EventBody, SOURCE_KEY, USER_ID } from '../__tests__/fakes';
import { FAILURE_REASONS } from '../processing/errors';
import { type JobEventPublisher, type VideoJobRepository } from '../processing/ports';

function message(body: string): Message {
  return { MessageId: 'dlq-1', ReceiptHandle: 'receipt-1', Body: body };
}

describe('createDlqHandler', () => {
  let repository: jest.Mocked<VideoJobRepository>;
  let publisher: jest.Mocked<JobEventPublisher>;
  let handler: ReturnType<typeof createDlqHandler>;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'PROCESSING' }),
      markProcessing: jest.fn(),
      markDone: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(true)
    };
    publisher = { createProgressReporter: jest.fn(), publishDone: jest.fn(), publishFailed: jest.fn() };
    handler = createDlqHandler({ repository, publisher, logger: createFakeLogger() });
  });

  it('should mark the job FAILED after the retries, publish job.failed and delete the message', async () => {
    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'delete' });

    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, 'Falha após 3 tentativas');
    expect(publisher.publishFailed).toHaveBeenCalledWith({
      jobId: JOB_ID,
      userId: USER_ID,
      reason: FAILURE_REASONS.retriesExhausted
    });
  });

  it('should not publish when the job is already in a final state', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'DONE' });
    repository.markFailed.mockResolvedValue(false);

    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'delete' });
    expect(publisher.publishFailed).not.toHaveBeenCalled();
  });

  it('should leave never-confirmed uploads to the expiration routine', async () => {
    repository.findById.mockResolvedValue({ id: JOB_ID, userId: USER_ID, status: 'UPLOAD_PENDING' });

    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'delete' });
    expect(repository.markFailed).not.toHaveBeenCalled();
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
  });
});
