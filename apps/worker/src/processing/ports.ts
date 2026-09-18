import { type VideoJobStatusName } from '@4frames/shared/jobs';

export interface JobRef {
  jobId: string;
  userId: number;
}

export interface VideoJobSnapshot {
  id: string;
  userId: number;
  status: VideoJobStatusName;
}

export interface CompletedJobData {
  zipKey: string;
  frameCount: number;
  durationSeconds: number;
}

/** Transições condicionais: devolvem `false` quando o job não estava no estado esperado (entrega duplicada). */
export interface VideoJobRepository {
  findById(jobId: string): Promise<VideoJobSnapshot | null>;
  /** QUEUED ou PROCESSING (tentativa anterior interrompida) → PROCESSING. */
  markProcessing(jobId: string): Promise<boolean>;
  /** PROCESSING → DONE. */
  markDone(jobId: string, data: CompletedJobData): Promise<boolean>;
  /** QUEUED ou PROCESSING → FAILED. */
  markFailed(jobId: string, reason: string): Promise<boolean>;
}

export interface UploadEntry {
  key: string;
  filePath: string;
  contentType: string;
}

export interface ObjectStore {
  /** Lança `ObjectNotFoundError` quando a chave não existe. */
  downloadToFile(key: string, filePath: string): Promise<void>;
  uploadFiles(entries: UploadEntry[]): Promise<void>;
}

export interface VideoMetadata {
  durationSeconds: number;
  formatName: string;
}

export interface VideoProbe {
  /** Lança `InvalidVideoError` quando o arquivo não é um vídeo aceito. */
  probe(filePath: string): Promise<VideoMetadata>;
}

export interface ExtractFramesInput {
  sourcePath: string;
  framesDir: string;
  durationSeconds: number;
  /** Fração de 0 a 1 do vídeo já processada. */
  onProgress?: (ratio: number) => void;
}

export interface FrameExtractor {
  /** Devolve os nomes dos frames gerados (frame_0001.png…), em ordem. */
  extract(input: ExtractFramesInput): Promise<string[]>;
}

export interface ZipFramesInput {
  framesDir: string;
  frameFiles: string[];
  zipPath: string;
}

export interface FrameZipper {
  zip(input: ZipFramesInput): Promise<void>;
}

export type ProgressReporter = (percent: number) => void;

export interface JobEventPublisher {
  createProgressReporter(job: JobRef): ProgressReporter;
  publishDone(event: JobRef & { zipKey: string; frameCount: number }): Promise<void>;
  publishFailed(event: JobRef & { reason: string }): Promise<void>;
}
