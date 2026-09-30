import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

import { QueueDepthMonitor } from './queue-depth-monitor';
import { createFakeLogger, createFakeMonitoring } from '../__tests__/fakes';

const UPLOADS_URL = 'http://localstack:4566/000000000000/4frames-video-uploads';
const DLQ_URL = 'http://localstack:4566/000000000000/4frames-video-uploads-dlq';

describe('QueueDepthMonitor', () => {
  const queues = [
    { name: 'uploads', url: UPLOADS_URL },
    { name: 'dlq', url: DLQ_URL }
  ];

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should record the visible and in-flight messages of each queue', async () => {
    const send = jest.fn(async (command: GetQueueAttributesCommand) => ({
      Attributes:
        command.input.QueueUrl === UPLOADS_URL
          ? { ApproximateNumberOfMessages: '4', ApproximateNumberOfMessagesNotVisible: '2' }
          : { ApproximateNumberOfMessages: '0', ApproximateNumberOfMessagesNotVisible: '0' }
    }));
    const monitoring = createFakeMonitoring();
    const monitor = new QueueDepthMonitor({ sqs: { send }, queues, monitoring, logger: createFakeLogger() });

    await monitor.poll();

    const [command] = send.mock.calls[0] as [GetQueueAttributesCommand];
    expect(command).toBeInstanceOf(GetQueueAttributesCommand);
    expect(command.input).toEqual({
      QueueUrl: UPLOADS_URL,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    });
    expect(monitoring.recordQueueDepth).toHaveBeenCalledWith('uploads', { visible: 4, inFlight: 2 });
    expect(monitoring.recordQueueDepth).toHaveBeenCalledWith('dlq', { visible: 0, inFlight: 0 });
  });

  it('should log a failed read and keep the other queues', async () => {
    const send = jest.fn(async (command: GetQueueAttributesCommand) => {
      if (command.input.QueueUrl === DLQ_URL) {
        throw new Error('connect ECONNREFUSED');
      }

      return { Attributes: { ApproximateNumberOfMessages: '1', ApproximateNumberOfMessagesNotVisible: '0' } };
    });
    const monitoring = createFakeMonitoring();
    const logger = createFakeLogger();
    const monitor = new QueueDepthMonitor({ sqs: { send }, queues, monitoring, logger });

    await expect(monitor.poll()).resolves.toBeUndefined();

    expect(monitoring.recordQueueDepth).toHaveBeenCalledTimes(1);
    expect(monitoring.recordQueueDepth).toHaveBeenCalledWith('uploads', { visible: 1, inFlight: 0 });
    expect(logger.warn).toHaveBeenCalledWith('Queue depth read failed', {
      queue: 'dlq',
      error: 'connect ECONNREFUSED'
    });
  });

  it('should read right away and then on every interval until stopped', async () => {
    jest.useFakeTimers();
    const send = jest.fn().mockResolvedValue({ Attributes: {} });
    const monitor = new QueueDepthMonitor({
      sqs: { send },
      queues: [queues[0]!],
      monitoring: createFakeMonitoring(),
      logger: createFakeLogger(),
      intervalMs: 1000
    });

    monitor.start();
    expect(send).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(3);

    monitor.stop();
    await jest.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('should not read the queues when metrics are disabled', () => {
    const send = jest.fn();
    const monitor = new QueueDepthMonitor({
      sqs: { send },
      queues,
      monitoring: createFakeMonitoring(false),
      logger: createFakeLogger()
    });

    monitor.start();
    monitor.stop();

    expect(send).not.toHaveBeenCalled();
  });
});
