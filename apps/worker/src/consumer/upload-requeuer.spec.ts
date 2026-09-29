import { type Message, SendMessageCommand } from '@aws-sdk/client-sqs';

import { readRequeueCount, REQUEUE_COUNT_ATTRIBUTE, SqsUploadRequeuer } from './upload-requeuer';
import { s3EventBody, SOURCE_KEY } from '../__tests__/fakes';

const QUEUE_URL = 'http://localstack:4566/000000000000/4frames-video-uploads';

function message(requeueCount?: string): Message {
  return {
    MessageId: 'dlq-1',
    ReceiptHandle: 'receipt-1',
    Body: s3EventBody(SOURCE_KEY),
    ...(requeueCount === undefined
      ? {}
      : { MessageAttributes: { [REQUEUE_COUNT_ATTRIBUTE]: { DataType: 'Number', StringValue: requeueCount } } })
  };
}

describe('readRequeueCount', () => {
  it('should read the counter, and treat a missing or invalid one as the original S3 event', () => {
    expect(readRequeueCount(message())).toBe(0);
    expect(readRequeueCount(message('2'))).toBe(2);
    expect(readRequeueCount(message('abc'))).toBe(0);
    expect(readRequeueCount(message('-1'))).toBe(0);
  });
});

describe('SqsUploadRequeuer', () => {
  it('should send the same body to the uploads queue as a new message, with the delay and the counter incremented', async () => {
    const send = jest.fn().mockResolvedValue({});
    const requeuer = new SqsUploadRequeuer({ sqs: { send }, queueUrl: QUEUE_URL });

    await requeuer.requeue(message('1'), 30);

    expect(send).toHaveBeenCalledTimes(1);
    const [command] = send.mock.calls[0] as [SendMessageCommand];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input).toEqual({
      QueueUrl: QUEUE_URL,
      MessageBody: s3EventBody(SOURCE_KEY),
      DelaySeconds: 30,
      MessageAttributes: { [REQUEUE_COUNT_ATTRIBUTE]: { DataType: 'Number', StringValue: '2' } }
    });
  });

  it('should start the counter at 1 for the original S3 event', async () => {
    const send = jest.fn().mockResolvedValue({});

    await new SqsUploadRequeuer({ sqs: { send }, queueUrl: QUEUE_URL }).requeue(message(), 0);

    const [command] = send.mock.calls[0] as [SendMessageCommand];
    expect(command.input.MessageAttributes).toEqual({
      [REQUEUE_COUNT_ATTRIBUTE]: { DataType: 'Number', StringValue: '1' }
    });
  });

  it('should reject when SQS fails, so the DLQ message is kept', async () => {
    const send = jest.fn().mockRejectedValue(new Error('SQS unavailable'));

    await expect(new SqsUploadRequeuer({ sqs: { send }, queueUrl: QUEUE_URL }).requeue(message(), 30)).rejects.toThrow(
      'SQS unavailable'
    );
  });
});
