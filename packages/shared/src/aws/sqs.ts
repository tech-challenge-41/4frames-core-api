import { SQSClient } from '@aws-sdk/client-sqs';

import { type AwsClientOptions, resolveAwsClientOptions } from './options';

export function createSqsClient(options: AwsClientOptions = {}): SQSClient {
  const { region, endpoint } = resolveAwsClientOptions(options);

  return new SQSClient({
    region,
    ...(endpoint ? { endpoint } : {})
  });
}
