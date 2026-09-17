import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildFrameKey, buildZipKey } from '@4frames/shared/jobs';
import { type Logger } from '@4frames/shared/logger';

import { FAILURE_REASONS, InvalidVideoError, ObjectNotFoundError, toError } from './errors';
import {
  type FrameExtractor,
  type FrameZipper,
  type JobEventPublisher,
  type JobRef,
  type ObjectStore,
  type VideoJobRepository,
  type VideoJobSnapshot,
  type VideoProbe
} from './ports';
import { parseJobSourceKey } from './source-key';
import { extractionPercent, PROGRESS } from '../progress/job-progress';

export type ProcessVideoJobResult =
  | { action: 'delete'; outcome: 'done' | 'failed' | 'discarded' }
  | { action: 'retry'; delaySeconds: number; outcome: 'awaiting-upload-confirmation' };

export interface UploadConfirmationOptions {
  /** Quanto esperar, no mesmo recebimento, o `POST /videos/{jobId}/complete` que vem logo depois do PUT. */
  waitMs: number;
  pollIntervalMs: number;
  /** Se o upload continuar sem confirmação, a mensagem volta à fila depois deste atraso. */
  retryDelaySeconds: number;
}

export const DEFAULT_UPLOAD_CONFIRMATION: UploadConfirmationOptions = {
  waitMs: 30_000,
  pollIntervalMs: 1000,
  retryDelaySeconds: 30
};

export interface ProcessVideoJobDependencies {
  repository: VideoJobRepository;
  storage: ObjectStore;
  probe: VideoProbe;
  extractor: FrameExtractor;
  zipper: FrameZipper;
  publisher: JobEventPublisher;
  logger: Logger;
  tmpDir: string;
  uploadConfirmation?: UploadConfirmationOptions;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const FRAME_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const DISCARDED = { action: 'delete', outcome: 'discarded' } as const;

/**
 * Processa o vídeo de uma chave `videos/{userId}/{jobId}/source.{ext}` (ADR-001 §2.2, passos 5 e 6).
 *
 * - Vídeo inválido (`InvalidVideoError`): FAILED com motivo, evento job.failed e a mensagem é apagada.
 * - Qualquer outro erro é relançado: a mensagem volta à fila e, depois de 3 recebimentos, vai para a DLQ.
 * - Ordem de gravação (ADR-001 §2.3): artefatos no S3 → status no banco → evento no Redis.
 */
export class ProcessVideoJobUseCase {
  private readonly deps: ProcessVideoJobDependencies;
  private readonly uploadConfirmation: UploadConfirmationOptions;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: ProcessVideoJobDependencies) {
    this.deps = deps;
    this.uploadConfirmation = deps.uploadConfirmation ?? DEFAULT_UPLOAD_CONFIRMATION;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? (ms => delay(ms));
  }

  public async execute({ key }: { key: string }): Promise<ProcessVideoJobResult> {
    const source = parseJobSourceKey(key);

    if (!source) {
      this.deps.logger.warn('Ignoring object key that is not a video source', { key });
      return DISCARDED;
    }

    const { jobId, userId, extension } = source;
    const log = this.deps.logger.child({ jobId, userId });

    const job = await this.findJobWaitingForConfirmation(jobId);

    if (!job) {
      log.warn('Job not found, ignoring message');
      return DISCARDED;
    }

    if (job.userId !== userId) {
      log.warn('Object key owner does not match the job owner, ignoring message', { jobOwnerId: job.userId });
      return DISCARDED;
    }

    if (job.status === 'UPLOAD_PENDING') {
      // O S3 publica o evento ao fim do PUT, antes de o front chamar o complete.
      const { retryDelaySeconds } = this.uploadConfirmation;
      log.info('Upload not confirmed yet, message will be retried', { retryInSeconds: retryDelaySeconds });
      return { action: 'retry', delaySeconds: retryDelaySeconds, outcome: 'awaiting-upload-confirmation' };
    }

    if (job.status !== 'QUEUED' && job.status !== 'PROCESSING') {
      log.info('Job is not waiting for processing, ignoring message', { status: job.status });
      return DISCARDED;
    }

    if (job.status === 'PROCESSING') {
      log.warn('Job was already PROCESSING, resuming an interrupted attempt');
    }

    if (!(await this.deps.repository.markProcessing(jobId))) {
      log.info('Job changed status before processing started, ignoring message');
      return DISCARDED;
    }

    return this.process({ jobId, userId }, key, extension, log);
  }

  private async findJobWaitingForConfirmation(jobId: string): Promise<VideoJobSnapshot | null> {
    const deadline = this.now() + this.uploadConfirmation.waitMs;
    let job = await this.deps.repository.findById(jobId);

    while (job?.status === 'UPLOAD_PENDING' && this.now() < deadline) {
      await this.sleep(this.uploadConfirmation.pollIntervalMs);
      job = await this.deps.repository.findById(jobId);
    }

    return job;
  }

  private async process(job: JobRef, key: string, extension: string, log: Logger): Promise<ProcessVideoJobResult> {
    const { jobId, userId } = job;
    const { repository, storage, probe, extractor, zipper, publisher } = this.deps;

    const workDir = path.join(this.deps.tmpDir, jobId);
    const framesDir = path.join(workDir, 'frames');
    const sourcePath = path.join(workDir, `source.${extension}`);
    const zipPath = path.join(workDir, 'frames.zip');
    const reportProgress = publisher.createProgressReporter(job);
    const startedAt = this.now();

    log.info('Processing started', { key });

    try {
      // Sobras de uma tentativa anterior interrompida neste mesmo disco.
      await fs.rm(workDir, { recursive: true, force: true });
      await fs.mkdir(framesDir, { recursive: true });

      await this.download(key, sourcePath);

      const { durationSeconds, formatName } = await probe.probe(sourcePath);
      log.info('Video probed', { durationSeconds, formatName });
      reportProgress(PROGRESS.probed);

      const frameFiles = await extractor.extract({
        sourcePath,
        framesDir,
        durationSeconds,
        onProgress: ratio => reportProgress(extractionPercent(ratio))
      });

      await zipper.zip({ framesDir, frameFiles, zipPath });
      reportProgress(PROGRESS.zipped);

      const zipKey = buildZipKey(userId, jobId);

      await storage.uploadFiles([
        ...frameFiles.map(file => ({
          key: buildFrameKey(userId, jobId, file),
          filePath: path.join(framesDir, file),
          contentType: FRAME_CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
        })),
        { key: zipKey, filePath: zipPath, contentType: 'application/zip' }
      ]);
      reportProgress(PROGRESS.uploaded);

      const frameCount = frameFiles.length;

      if (!(await repository.markDone(jobId, { zipKey, frameCount, durationSeconds }))) {
        log.warn('Job left PROCESSING while it was being processed, result not recorded', { zipKey });
        return DISCARDED;
      }

      await publisher.publishDone({ jobId, userId, zipKey, frameCount });
      log.info('Processing finished', { frameCount, zipKey, elapsedMs: this.now() - startedAt });

      return { action: 'delete', outcome: 'done' };
    } catch (error) {
      if (!(error instanceof InvalidVideoError)) {
        throw error;
      }

      log.warn('Video rejected', { reason: error.reason, details: error.details });

      if (await repository.markFailed(jobId, error.reason)) {
        await publisher.publishFailed({ jobId, userId, reason: error.reason });
      }

      return { action: 'delete', outcome: 'failed' };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
        log.warn('Failed to remove temporary files', { workDir, error: toError(error).message });
      });
    }
  }

  private async download(key: string, filePath: string): Promise<void> {
    try {
      await this.deps.storage.downloadToFile(key, filePath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new InvalidVideoError(FAILURE_REASONS.sourceNotFound, key);
      }

      throw error;
    }
  }
}
