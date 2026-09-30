import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FAILURE_REASONS, InvalidVideoError, ObjectNotFoundError } from './errors';
import {
  type FrameExtractor,
  type FrameZipper,
  type JobEventPublisher,
  type ObjectStore,
  type VideoJobRepository,
  type VideoJobSnapshot,
  type VideoProbe
} from './ports';
import { ProcessVideoJobUseCase } from './process-video-job.usecase';
import { createFakeLogger, createFakeMonitoring, JOB_ID, SOURCE_KEY, USER_ID } from '../__tests__/fakes';

function buildJob(overrides: Partial<VideoJobSnapshot> = {}): VideoJobSnapshot {
  return { id: JOB_ID, userId: USER_ID, status: 'QUEUED', ...overrides };
}

describe('ProcessVideoJobUseCase', () => {
  let tmpDir: string;
  let calls: string[];
  let repository: jest.Mocked<VideoJobRepository>;
  let storage: jest.Mocked<ObjectStore>;
  let probe: jest.Mocked<VideoProbe>;
  let extractor: jest.Mocked<FrameExtractor>;
  let zipper: jest.Mocked<FrameZipper>;
  let publisher: jest.Mocked<JobEventPublisher>;
  let reportProgress: jest.Mock;
  let monitoring: ReturnType<typeof createFakeMonitoring>;
  let clock: number;
  let useCase: ProcessVideoJobUseCase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '4frames-worker-usecase-'));
    calls = [];
    clock = 0;
    reportProgress = jest.fn();
    monitoring = createFakeMonitoring();

    repository = {
      findById: jest.fn().mockResolvedValue(buildJob()),
      markProcessing: jest.fn().mockResolvedValue(true),
      markDone: jest.fn(async () => {
        calls.push('db:done');
        return true;
      }),
      markFailed: jest.fn(async () => {
        calls.push('db:failed');
        return true;
      })
    };
    storage = {
      downloadToFile: jest.fn(async (_key: string, filePath: string) => {
        calls.push('s3:download');
        fs.writeFileSync(filePath, 'video');
      }),
      uploadFiles: jest.fn(async () => {
        calls.push('s3:upload');
      })
    };
    probe = { probe: jest.fn().mockResolvedValue({ durationSeconds: 45.2, formatName: 'mov,mp4,m4a,3gp,3g2,mj2' }) };
    extractor = {
      extract: jest.fn(async ({ onProgress }) => {
        onProgress?.(0.5);
        return ['frame_0001.png', 'frame_0002.png'];
      })
    };
    zipper = { zip: jest.fn().mockResolvedValue(undefined) };
    publisher = {
      createProgressReporter: jest.fn().mockReturnValue(reportProgress),
      publishDone: jest.fn(async () => {
        calls.push('redis:done');
      }),
      publishFailed: jest.fn(async () => {
        calls.push('redis:failed');
      })
    };

    useCase = new ProcessVideoJobUseCase({
      repository,
      storage,
      probe,
      extractor,
      zipper,
      publisher,
      logger: createFakeLogger(),
      tmpDir,
      monitoring,
      uploadConfirmation: { waitMs: 3000, pollIntervalMs: 1000, retryDelaySeconds: 30 },
      now: () => clock,
      sleep: async ms => {
        clock += ms;
      }
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should process a queued job: artifacts in S3, then DONE in the database, then job.done in Redis', async () => {
    const result = await useCase.execute({ key: SOURCE_KEY });

    expect(result).toEqual({ action: 'delete', outcome: 'done' });
    expect(repository.markProcessing).toHaveBeenCalledWith(JOB_ID);
    expect(calls).toEqual(['s3:download', 's3:upload', 'db:done', 'redis:done']);

    const workDir = path.join(tmpDir, JOB_ID);
    expect(storage.downloadToFile).toHaveBeenCalledWith(SOURCE_KEY, path.join(workDir, 'source.mp4'));
    expect(probe.probe).toHaveBeenCalledWith(path.join(workDir, 'source.mp4'));
    expect(zipper.zip).toHaveBeenCalledWith({
      framesDir: path.join(workDir, 'frames'),
      frameFiles: ['frame_0001.png', 'frame_0002.png'],
      zipPath: path.join(workDir, 'frames.zip')
    });
    expect(storage.uploadFiles).toHaveBeenCalledWith([
      {
        key: `frames/${USER_ID}/${JOB_ID}/frame_0001.png`,
        filePath: path.join(workDir, 'frames', 'frame_0001.png'),
        contentType: 'image/png'
      },
      {
        key: `frames/${USER_ID}/${JOB_ID}/frame_0002.png`,
        filePath: path.join(workDir, 'frames', 'frame_0002.png'),
        contentType: 'image/png'
      },
      {
        key: `zips/${USER_ID}/${JOB_ID}.zip`,
        filePath: path.join(workDir, 'frames.zip'),
        contentType: 'application/zip'
      }
    ]);
    expect(repository.markDone).toHaveBeenCalledWith(JOB_ID, {
      zipKey: `zips/${USER_ID}/${JOB_ID}.zip`,
      frameCount: 2,
      durationSeconds: 45.2
    });
    expect(publisher.publishDone).toHaveBeenCalledWith({
      jobId: JOB_ID,
      userId: USER_ID,
      zipKey: `zips/${USER_ID}/${JOB_ID}.zip`,
      frameCount: 2
    });
    expect(monitoring.incrementVideoJobsDone).toHaveBeenCalledTimes(1);
    expect(monitoring.captureJobProcessingDuration).toHaveBeenCalledTimes(1);
    expect(monitoring.incrementVideoJobsFailed).not.toHaveBeenCalled();
  });

  it('should report progress across the pipeline and remove the temporary directory', async () => {
    await useCase.execute({ key: SOURCE_KEY });

    expect(publisher.createProgressReporter).toHaveBeenCalledWith({ jobId: JOB_ID, userId: USER_ID });
    expect(reportProgress.mock.calls.map(([percent]) => percent)).toEqual([5, 45, 90, 99]);
    expect(fs.existsSync(path.join(tmpDir, JOB_ID))).toBe(false);
  });

  it('should resume a job left in PROCESSING by a worker that went down', async () => {
    repository.findById.mockResolvedValue(buildJob({ status: 'PROCESSING' }));

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'done' });
    expect(repository.markProcessing).toHaveBeenCalledWith(JOB_ID);
  });

  it.each(['DONE', 'FAILED', 'EXPIRED'] as const)(
    'should discard the message when the job is already %s',
    async status => {
      repository.findById.mockResolvedValue(buildJob({ status }));

      await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'discarded' });
      expect(repository.markProcessing).not.toHaveBeenCalled();
      expect(storage.downloadToFile).not.toHaveBeenCalled();
    }
  );

  it('should discard the message when another delivery claimed the job first', async () => {
    repository.markProcessing.mockResolvedValue(false);

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'discarded' });
    expect(storage.downloadToFile).not.toHaveBeenCalled();
  });

  it('should discard keys that are not video sources, jobs that do not exist and owner mismatches', async () => {
    await expect(useCase.execute({ key: `zips/${USER_ID}/${JOB_ID}.zip` })).resolves.toMatchObject({
      outcome: 'discarded'
    });
    await expect(useCase.execute({ key: `videos/${USER_ID}/42/source.mp4` })).resolves.toMatchObject({
      outcome: 'discarded'
    });

    repository.findById.mockResolvedValueOnce(null);
    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toMatchObject({ outcome: 'discarded' });

    repository.findById.mockResolvedValueOnce(buildJob({ userId: USER_ID + 1 }));
    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toMatchObject({ outcome: 'discarded' });

    expect(repository.markProcessing).not.toHaveBeenCalled();
  });

  it('should wait for the upload confirmation that follows the PUT and then process the job', async () => {
    repository.findById
      .mockResolvedValueOnce(buildJob({ status: 'UPLOAD_PENDING' }))
      .mockResolvedValueOnce(buildJob({ status: 'QUEUED' }));

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'done' });
    expect(repository.findById).toHaveBeenCalledTimes(2);
  });

  it('should return the message to the queue when the upload is still not confirmed', async () => {
    repository.findById.mockResolvedValue(buildJob({ status: 'UPLOAD_PENDING' }));

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({
      action: 'retry',
      delaySeconds: 30,
      outcome: 'awaiting-upload-confirmation'
    });
    // 3 s de espera com consulta a cada 1 s: a primeira leitura e mais três.
    expect(repository.findById).toHaveBeenCalledTimes(4);
    expect(repository.markProcessing).not.toHaveBeenCalled();
  });

  it('should mark the job FAILED with the reason and publish job.failed when the video is invalid', async () => {
    probe.probe.mockRejectedValue(new InvalidVideoError(FAILURE_REASONS.invalidVideo, 'moov atom not found'));

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'failed' });
    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, FAILURE_REASONS.invalidVideo);
    expect(publisher.publishFailed).toHaveBeenCalledWith({
      jobId: JOB_ID,
      userId: USER_ID,
      reason: FAILURE_REASONS.invalidVideo
    });
    expect(monitoring.incrementVideoJobsFailed).toHaveBeenCalledWith('invalid_video');
    expect(calls).toEqual(['s3:download', 'db:failed', 'redis:failed']);
    expect(repository.markDone).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, JOB_ID))).toBe(false);
  });

  it('should not publish job.failed when the job already left PROCESSING', async () => {
    extractor.extract.mockRejectedValue(new InvalidVideoError(FAILURE_REASONS.noFrames));
    repository.markFailed.mockResolvedValue(false);

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'failed' });
    expect(publisher.publishFailed).not.toHaveBeenCalled();
    expect(monitoring.incrementVideoJobsFailed).not.toHaveBeenCalled();
  });

  it('should fail the job when the source video no longer exists in the bucket', async () => {
    storage.downloadToFile.mockRejectedValue(new ObjectNotFoundError(SOURCE_KEY));

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toMatchObject({ outcome: 'failed' });
    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, FAILURE_REASONS.sourceNotFound);
  });

  it.each([
    ['download', () => storage.downloadToFile.mockRejectedValue(new Error('socket hang up'))],
    ['upload', () => storage.uploadFiles.mockRejectedValue(new Error('SlowDown'))],
    ['database', () => repository.markDone.mockRejectedValue(new Error('connection terminated'))],
    ['ffmpeg killed', () => extractor.extract.mockRejectedValue(new Error('ffmpeg was killed by SIGKILL'))]
  ])('should rethrow transient errors (%s) so the message goes back to the queue', async (_name, arrange) => {
    arrange();

    await expect(useCase.execute({ key: SOURCE_KEY })).rejects.toThrow();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(publisher.publishFailed).not.toHaveBeenCalled();
    expect(publisher.publishDone).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, JOB_ID))).toBe(false);
  });

  it('should not publish job.done when the job left PROCESSING before completion', async () => {
    repository.markDone.mockResolvedValue(false);

    await expect(useCase.execute({ key: SOURCE_KEY })).resolves.toEqual({ action: 'delete', outcome: 'discarded' });
    expect(publisher.publishDone).not.toHaveBeenCalled();
    expect(monitoring.incrementVideoJobsDone).not.toHaveBeenCalled();
  });
});
