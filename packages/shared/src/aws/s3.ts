import { S3Client } from '@aws-sdk/client-s3';

import { type AwsClientOptions, resolveAwsClientOptions } from './options';

export interface S3ClientOptions extends AwsClientOptions {
  /** Padrão: true quando há endpoint customizado (LocalStack exige path-style). */
  forcePathStyle?: boolean;
}

export function createS3Client(options: S3ClientOptions = {}): S3Client {
  const { region, endpoint } = resolveAwsClientOptions(options);

  return new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: options.forcePathStyle ?? Boolean(endpoint),
    // Sem isso o SDK v3 adiciona checksum CRC32 obrigatório às URLs pré-assinadas,
    // e o PUT direto do navegador (e o LocalStack) responde 400 InvalidRequest.
    requestChecksumCalculation: 'WHEN_REQUIRED'
  });
}
