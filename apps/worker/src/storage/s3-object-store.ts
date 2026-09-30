import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { mapWithConcurrency } from './map-with-concurrency';
import { ObjectNotFoundError } from '../processing/errors';
import { type ObjectStore, type UploadEntry } from '../processing/ports';

export const DEFAULT_UPLOAD_CONCURRENCY = 8;

export interface S3ObjectStoreOptions {
  s3: S3Client;
  bucket: string;
  uploadConcurrency?: number;
}

function isNoSuchKey(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;

  return name === 'NoSuchKey' || name === 'NotFound';
}

export class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly uploadConcurrency: number;

  constructor({ s3, bucket, uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY }: S3ObjectStoreOptions) {
    this.s3 = s3;
    this.bucket = bucket;
    this.uploadConcurrency = uploadConcurrency;
  }

  /** Baixa em streaming para disco: o ffmpeg precisa de um arquivo com acesso aleatório. */
  public async downloadToFile(key: string, filePath: string): Promise<void> {
    let body: unknown;

    try {
      const output = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      body = output.Body;
    } catch (error) {
      if (isNoSuchKey(error)) {
        throw new ObjectNotFoundError(key);
      }

      throw error;
    }

    if (!(body instanceof Readable)) {
      throw new Error(`S3 returned an unexpected body for ${key}`);
    }

    await pipeline(body, fs.createWriteStream(filePath));
  }

  public async uploadFiles(entries: UploadEntry[]): Promise<void> {
    await mapWithConcurrency(entries, this.uploadConcurrency, entry => this.uploadFile(entry));
  }

  private async uploadFile({ key, filePath, contentType }: UploadEntry): Promise<void> {
    const body = fs.createReadStream(filePath);

    try {
      // Upload do lib-storage troca para multipart sozinho quando o arquivo passa do tamanho de uma parte (zip grande).
      await new Upload({
        client: this.s3,
        params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }
      }).done();
    } finally {
      // Se o upload falhar no meio, o arquivo não fica aberto.
      body.destroy();
    }
  }
}
