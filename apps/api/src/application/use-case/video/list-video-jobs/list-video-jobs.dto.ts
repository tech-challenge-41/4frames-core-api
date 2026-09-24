export interface ListVideoJobsInputDTO {
  userId: number;
  limit: number;
  offset: number;
}

export interface VideoJobListItemDTO {
  jobId: string;
  fileName: string;
  status: string;
  createdAt: Date;
  /** Presente só quando o job terminou em FAILED e o worker gravou o motivo. */
  failureReason?: string;
  /** true quando o job está DONE e tem um .zip disponível para download. */
  hasDownload: boolean;
}

export interface ListVideoJobsOutputDTO {
  items: VideoJobListItemDTO[];
  total: number;
  limit: number;
  offset: number;
}
