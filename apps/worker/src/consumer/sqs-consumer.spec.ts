import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand
} from '@aws-sdk/client-sqs';

import { type MessageHandler } from './message-handler';
import { SqsConsumer, type SqsConsumerOptions } from './sqs-consumer';
import { createFakeLogger } from '../__tests__/fakes';

const QUEUE_URL = 'http://localstack:4566/000000000000/4frames-video-uploads';

async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();

  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
}

function buildMessage(id: string): Message {
  return { MessageId: id, ReceiptHandle: `receipt-${id}`, Body: '{}', Attributes: { ApproximateReceiveCount: '1' } };
}

/**
 * SQS falso: cada ReceiveMessage entrega o próximo lote da lista; sem lotes, fica em long polling
 * até o abortSignal, como o SDK real.
 */
function createFakeSqs(batches: Array<Message[] | Error>) {
  const send = jest.fn((command: unknown, options?: { abortSignal?: AbortSignal }) => {
    if (command instanceof ReceiveMessageCommand) {
      const next = batches.shift();

      if (next instanceof Error) {
        return Promise.reject(next);
      }

      if (next) {
        return Promise.resolve({ Messages: next });
      }

      return new Promise((_resolve, reject) => {
        options?.abortSignal?.addEventListener('abort', () => reject(new Error('Request aborted')));
      });
    }

    return Promise.resolve({});
  });

  const inputsOf = (type: new (...args: never[]) => unknown) =>
    send.mock.calls
      .map(([command]) => command)
      .filter(command => command instanceof type)
      .map(command => (command as { input: Record<string, unknown> }).input);

  return { send, inputsOf };
}

describe('SqsConsumer', () => {
  let consumers: SqsConsumer[];

  function createConsumer(options: Partial<SqsConsumerOptions> & Pick<SqsConsumerOptions, 'sqs' | 'handler'>) {
    const consumer = new SqsConsumer({
      name: 'uploads',
      queueUrl: QUEUE_URL,
      logger: createFakeLogger(),
      visibilityTimeoutSeconds: 600,
      receiveErrorBackoffMs: 10,
      ...options
    });
    consumers.push(consumer);

    return consumer;
  }

  beforeEach(() => {
    consumers = [];
  });

  afterEach(async () => {
    await Promise.all(consumers.map(consumer => consumer.stop()));
  });

  it('should long poll one message at a time with the configured visibility timeout', async () => {
    const sqs = createFakeSqs([]);
    const consumer = createConsumer({ sqs, handler: jest.fn(), waitTimeSeconds: 20 });

    void consumer.start();

    await waitFor(() => expect(sqs.inputsOf(ReceiveMessageCommand)).toHaveLength(1));
    expect(sqs.inputsOf(ReceiveMessageCommand)[0]).toEqual({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 600,
      MessageSystemAttributeNames: ['ApproximateReceiveCount']
    });
  });

  it('should delete the message when the handler finishes it', async () => {
    const sqs = createFakeSqs([[buildMessage('1')]]);
    const handler: MessageHandler = jest.fn().mockResolvedValue({ action: 'delete' });
    const consumer = createConsumer({ sqs, handler });

    void consumer.start();

    await waitFor(() =>
      expect(sqs.inputsOf(DeleteMessageCommand)).toEqual([{ QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-1' }])
    );
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ MessageId: '1' }));
  });

  it('should return the message to the queue with the requested delay on retry', async () => {
    const sqs = createFakeSqs([[buildMessage('1')]]);
    const consumer = createConsumer({
      sqs,
      handler: jest.fn().mockResolvedValue({ action: 'retry', delaySeconds: 30 })
    });

    void consumer.start();

    await waitFor(() =>
      expect(sqs.inputsOf(ChangeMessageVisibilityCommand)).toEqual([
        { QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-1', VisibilityTimeout: 30 }
      ])
    );
    expect(sqs.inputsOf(DeleteMessageCommand)).toHaveLength(0);
  });

  it('should not delete the message on a transient error and make it visible again after the retry delay', async () => {
    const sqs = createFakeSqs([[buildMessage('1')], [buildMessage('2')]]);
    const handler = jest
      .fn()
      .mockRejectedValueOnce(new Error('S3 unavailable'))
      .mockResolvedValueOnce({ action: 'delete' });
    const consumer = createConsumer({ sqs, handler, transientRetryDelaySeconds: 45 });

    void consumer.start();

    await waitFor(() => expect(sqs.inputsOf(DeleteMessageCommand)).toHaveLength(1));
    expect(sqs.inputsOf(ChangeMessageVisibilityCommand)).toEqual([
      { QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-1', VisibilityTimeout: 45 }
    ]);
    expect(sqs.inputsOf(DeleteMessageCommand)).toEqual([{ QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-2' }]);
  });

  it('should extend the visibility timeout while a long job is running (heartbeat)', async () => {
    const sqs = createFakeSqs([[buildMessage('1')]]);
    let finishJob: () => void = () => undefined;
    const handler = jest.fn(
      () =>
        new Promise(resolve => {
          finishJob = () => resolve({ action: 'delete' });
        })
    );
    // 0,04 s de visibilidade → heartbeat a cada 20 ms.
    const consumer = createConsumer({ sqs, handler, visibilityTimeoutSeconds: 0.04 });

    void consumer.start();

    await waitFor(() => expect(sqs.inputsOf(ChangeMessageVisibilityCommand).length).toBeGreaterThanOrEqual(2));
    expect(sqs.inputsOf(ChangeMessageVisibilityCommand)[0]).toEqual({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: 'receipt-1',
      VisibilityTimeout: 0.04
    });

    finishJob();
    await waitFor(() => expect(sqs.inputsOf(DeleteMessageCommand)).toHaveLength(1));

    const heartbeats = sqs.inputsOf(ChangeMessageVisibilityCommand).length;
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(sqs.inputsOf(ChangeMessageVisibilityCommand)).toHaveLength(heartbeats);
  });

  it('should interrupt the long polling on stop', async () => {
    const sqs = createFakeSqs([]);
    const consumer = createConsumer({ sqs, handler: jest.fn() });
    const loop = consumer.start();

    await waitFor(() => expect(sqs.inputsOf(ReceiveMessageCommand)).toHaveLength(1));
    expect(consumer.isAlive()).toBe(true);

    await consumer.stop();
    await expect(loop).resolves.toBeUndefined();
    expect(consumer.isAlive()).toBe(false);
    expect(sqs.inputsOf(ReceiveMessageCommand)).toHaveLength(1);
  });

  it('should finish the current message before stopping (SIGTERM on scale-down)', async () => {
    const sqs = createFakeSqs([[buildMessage('1')]]);
    let finishJob: () => void = () => undefined;
    const handler = jest.fn(
      () =>
        new Promise(resolve => {
          finishJob = () => resolve({ action: 'delete' });
        })
    );
    const consumer = createConsumer({ sqs, handler });

    void consumer.start();
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = consumer.stop().then(() => {
      stopped = true;
    });

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    expect(consumer.isAlive()).toBe(true);

    finishJob();
    await stopping;

    expect(sqs.inputsOf(DeleteMessageCommand)).toEqual([{ QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-1' }]);
    expect(sqs.inputsOf(ReceiveMessageCommand)).toHaveLength(1);
  });

  it('should back off and keep polling after a receive error', async () => {
    const sqs = createFakeSqs([new Error('connect ECONNREFUSED'), [buildMessage('1')]]);
    const handler = jest.fn().mockResolvedValue({ action: 'delete' });
    const consumer = createConsumer({ sqs, handler });

    void consumer.start();

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(sqs.inputsOf(ReceiveMessageCommand).length).toBeGreaterThanOrEqual(2);
  });

  it('should wake up from the error backoff when stopped', async () => {
    const sqs = createFakeSqs([new Error('connect ECONNREFUSED')]);
    const consumer = createConsumer({ sqs, handler: jest.fn(), receiveErrorBackoffMs: 60_000 });

    void consumer.start();
    await waitFor(() => expect(sqs.inputsOf(ReceiveMessageCommand)).toHaveLength(1));

    const startedAt = Date.now();
    await consumer.stop();

    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('should process up to maxParallelJobs messages concurrently', async () => {
    const sqs = createFakeSqs([[buildMessage('1'), buildMessage('2')], [buildMessage('3')]]);
    let active = 0;
    let maxActive = 0;
    const handler: MessageHandler = jest.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 30));
      active -= 1;

      return { action: 'delete' };
    });
    const consumer = createConsumer({ sqs, handler, maxParallelJobs: 2 });

    void consumer.start();

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(3);
      expect(sqs.inputsOf(DeleteMessageCommand)).toHaveLength(3);
    });
    expect(maxActive).toBe(2);
  });

  it('should keep polling after an empty poll while a long job is still running', async () => {
    // Um poll vazio no meio de um job longo: antes, o laço esperava o job terminar para voltar a
    // buscar, e uma mensagem que chegasse logo depois ficava parada na fila.
    const sqs = createFakeSqs([[buildMessage('long')], [], [buildMessage('next')]]);
    const started: string[] = [];
    let releaseLongJob: () => void = () => undefined;
    const handler: MessageHandler = jest.fn(async message => {
      started.push(message.MessageId as string);

      if (message.MessageId === 'long') {
        await new Promise<void>(resolve => {
          releaseLongJob = resolve;
        });
      }

      return { action: 'delete' };
    });
    const consumer = createConsumer({ sqs, handler, maxParallelJobs: 2 });

    void consumer.start();

    try {
      await waitFor(() => expect(started).toEqual(['long', 'next']));
    } finally {
      // Sempre: sem liberar o job longo, o stop() do afterEach espera por ele para sempre e a
      // suíte trava em vez de reportar a falha.
      releaseLongJob();
    }
  });

  it('should report not alive when the loop has been silent for too long', async () => {
    let clock = 0;
    const sqs = createFakeSqs([]);
    const consumer = createConsumer({ sqs, handler: jest.fn(), maxSilenceMs: 60_000, now: () => clock });

    expect(consumer.isAlive()).toBe(false);

    void consumer.start();
    await waitFor(() => expect(sqs.inputsOf(ReceiveMessageCommand)).toHaveLength(1));

    clock = 60_000;
    expect(consumer.isAlive()).toBe(true);

    clock = 60_001;
    expect(consumer.isAlive()).toBe(false);
  });
});
