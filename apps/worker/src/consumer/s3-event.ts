import { z } from 'zod';

export interface S3ObjectRecord {
  eventName: string;
  bucket: string;
  /** Chave já decodificada. */
  key: string;
}

export type S3EventMessage =
  { kind: 'test' } | { kind: 'records'; records: S3ObjectRecord[] } | { kind: 'invalid'; reason: string };

const testEventSchema = z.object({ Event: z.literal('s3:TestEvent') });

const recordsEventSchema = z.object({
  Records: z
    .array(
      z.object({
        eventName: z.string(),
        s3: z.object({
          bucket: z.object({ name: z.string() }),
          object: z.object({ key: z.string().min(1) })
        })
      })
    )
    .min(1)
});

/** As chaves chegam codificadas como em URL, com espaço virando `+`. */
export function decodeS3ObjectKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

/** Interpreta o corpo de uma mensagem publicada pela notificação S3 → SQS. Nunca lança. */
export function parseS3EventMessage(body: string | undefined): S3EventMessage {
  let payload: unknown;

  try {
    payload = JSON.parse(body ?? '');
  } catch {
    return { kind: 'invalid', reason: 'body is not JSON' };
  }

  if (testEventSchema.safeParse(payload).success) {
    return { kind: 'test' };
  }

  const parsed = recordsEventSchema.safeParse(payload);

  if (!parsed.success) {
    return { kind: 'invalid', reason: 'body is not an S3 event notification' };
  }

  try {
    return {
      kind: 'records',
      records: parsed.data.Records.map(record => ({
        eventName: record.eventName,
        bucket: record.s3.bucket.name,
        key: decodeS3ObjectKey(record.s3.object.key)
      }))
    };
  } catch {
    return { kind: 'invalid', reason: 'object key is not correctly encoded' };
  }
}
