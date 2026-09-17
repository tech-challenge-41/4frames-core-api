export interface VideoJobRecord {
  /** UUID gerado pelo banco. */
  id: string;
  userId: number;
  fileName: string;
  contentType: string;
  /** Tamanho declarado na criação do job, em bytes. */
  fileSize: number;
  status: string;
  /** Preenchido pelo worker quando o job termina em FAILED. */
  failureReason: string | null;
}

export interface CreateUploadPendingJobInput {
  userId: number;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface IVideoJobService {
  createUploadPendingJob(input: CreateUploadPendingJobInput): Promise<VideoJobRecord>;
  findById(jobId: string): Promise<VideoJobRecord | null>;
  updateStatus(jobId: string, status: string): Promise<VideoJobRecord>;
}
