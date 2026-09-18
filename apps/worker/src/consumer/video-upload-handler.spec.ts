import { type Message } from '@aws-sdk/client-sqs';

import { createVideoUploadHandler } from './video-upload-handler';
import { createFakeLogger, JOB_ID, s3EventBody, SOURCE_KEY } from '../__tests__/fakes';

function message(body: string): Message {
  return { MessageId: 'msg-1', ReceiptHandle: 'receipt-1', Body: body };
}

describe('createVideoUploadHandler', () => {
  const execute = jest.fn();
  const handler = createVideoUploadHandler({
    processVideoJob: { execute },
    bucket: '4frames-videos',
    logger: createFakeLogger()
  });

  it('should delete the s3:TestEvent without processing anything', async () => {
    await expect(handler(message(JSON.stringify({ Event: 's3:TestEvent' })))).resolves.toEqual({ action: 'delete' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('should delete a malformed message instead of retrying it', async () => {
    await expect(handler(message('not json'))).resolves.toEqual({ action: 'delete' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('should process the uploaded object and delete the message', async () => {
    execute.mockResolvedValue({ action: 'delete', outcome: 'done' });

    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'delete' });
    expect(execute).toHaveBeenCalledWith({ key: SOURCE_KEY });
  });

  it('should ask for a delayed retry when the use case is waiting for the upload confirmation', async () => {
    execute.mockResolvedValue({ action: 'retry', delaySeconds: 30, outcome: 'awaiting-upload-confirmation' });

    await expect(handler(message(s3EventBody(SOURCE_KEY)))).resolves.toEqual({ action: 'retry', delaySeconds: 30 });
  });

  it('should ignore records from another bucket or other event types', async () => {
    await handler(message(s3EventBody(SOURCE_KEY, { bucket: 'other-bucket' })));
    await handler(message(s3EventBody(`videos/7/${JOB_ID}/source.mp4`, { eventName: 'ObjectRemoved:Delete' })));

    expect(execute).not.toHaveBeenCalled();
  });

  it('should propagate transient errors so the consumer returns the message to the queue', async () => {
    execute.mockRejectedValue(new Error('database unavailable'));

    await expect(handler(message(s3EventBody(SOURCE_KEY)))).rejects.toThrow('database unavailable');
  });
});
