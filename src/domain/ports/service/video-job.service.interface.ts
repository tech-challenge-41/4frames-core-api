export interface VideoJobRecord {
  id: number;
  userId: number;
  fileName: string;
  contentType: string;
  status: string;
  // Placeholder para quando o worker gravar o motivo de falha (sem coluna no banco ainda).
  failureReason?: string | null;
}

export interface IVideoJobService {
  createUploadPendingJob(userId: number, fileName: string, contentType: string): Promise<VideoJobRecord>;
  findById(jobId: number): Promise<VideoJobRecord | null>;
  updateStatus(jobId: number, status: string): Promise<VideoJobRecord>;
}
