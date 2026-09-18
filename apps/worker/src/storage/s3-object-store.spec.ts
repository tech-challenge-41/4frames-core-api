import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { GetObjectCommand, NoSuchKey, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { S3ObjectStore } from './s3-object-store';
import { ObjectNotFoundError } from '../processing/errors';

jest.mock('@aws-sdk/lib-storage', () => ({ Upload: jest.fn() }));

const UploadMock = Upload as unknown as jest.Mock;

/** Espera os ReadStreams entregues ao Upload fecharem antes de apagar o diretório temporário. */
function closeUploadBodies(): Promise<unknown[]> {
  return Promise.all(
    UploadMock.mock.calls.map(([options]) => {
      const body = options.params.Body as fs.ReadStream;

      return new Promise(resolve => {
        body.once('error', resolve);
        body.once('close', resolve);

        if (body.closed) {
          resolve(undefined);
        }
      });
    })
  );
}

describe('S3ObjectStore', () => {
  let workDir: string;
  let send: jest.Mock;
  let store: S3ObjectStore;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), '4frames-s3-'));
    send = jest.fn();
    store = new S3ObjectStore({ s3: { send } as unknown as S3Client, bucket: '4frames-videos', uploadConcurrency: 2 });
    UploadMock.mockImplementation(() => ({ done: jest.fn().mockResolvedValue({}) }));
  });

  afterEach(async () => {
    await closeUploadBodies();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('should stream the object to a local file', async () => {
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('video-'), Buffer.from('bytes')]) });
    const filePath = path.join(workDir, 'source.mp4');

    await store.downloadToFile('videos/1/job/source.mp4', filePath);

    const [command] = send.mock.calls[0] as [GetObjectCommand];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: '4frames-videos', Key: 'videos/1/job/source.mp4' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('video-bytes');
  });

  it('should translate NoSuchKey into ObjectNotFoundError', async () => {
    send.mockRejectedValue(new NoSuchKey({ message: 'The specified key does not exist.', $metadata: {} }));

    await expect(store.downloadToFile('videos/1/job/source.mp4', path.join(workDir, 'x'))).rejects.toBeInstanceOf(
      ObjectNotFoundError
    );
  });

  it('should propagate other S3 errors as they are', async () => {
    send.mockRejectedValue(new Error('socket hang up'));

    await expect(store.downloadToFile('k', path.join(workDir, 'x'))).rejects.toThrow('socket hang up');
  });

  it('should reject a body that is not a stream', async () => {
    send.mockResolvedValue({ Body: undefined });

    await expect(store.downloadToFile('k', path.join(workDir, 'x'))).rejects.toThrow('unexpected body');
  });

  it('should upload every file with its key and content type', async () => {
    const files = ['frame_0001.png', 'frames.zip'].map(name => {
      const filePath = path.join(workDir, name);
      fs.writeFileSync(filePath, name);
      return filePath;
    });

    await store.uploadFiles([
      { key: 'frames/1/job/frame_0001.png', filePath: files[0]!, contentType: 'image/png' },
      { key: 'zips/1/job.zip', filePath: files[1]!, contentType: 'application/zip' }
    ]);

    expect(UploadMock).toHaveBeenCalledTimes(2);
    expect(UploadMock.mock.calls.map(([options]) => options.params)).toEqual([
      expect.objectContaining({
        Bucket: '4frames-videos',
        Key: 'frames/1/job/frame_0001.png',
        ContentType: 'image/png'
      }),
      expect.objectContaining({ Bucket: '4frames-videos', Key: 'zips/1/job.zip', ContentType: 'application/zip' })
    ]);
    expect(UploadMock.mock.calls.every(([options]) => options.params.Body.destroyed)).toBe(true);
  });

  it('should fail when an upload fails', async () => {
    const filePath = path.join(workDir, 'frames.zip');
    fs.writeFileSync(filePath, 'zip');
    UploadMock.mockImplementation(() => ({ done: jest.fn().mockRejectedValue(new Error('SlowDown')) }));

    await expect(
      store.uploadFiles([{ key: 'zips/1/job.zip', filePath, contentType: 'application/zip' }])
    ).rejects.toThrow('SlowDown');
    expect(UploadMock.mock.calls[0]?.[0].params.Body.destroyed).toBe(true);
  });
});
