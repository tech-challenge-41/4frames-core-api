export interface GetVideoJobStatusInputDTO {
  userId: number;
  /** UUID do job. */
  jobId: string;
}

export interface GetVideoJobStatusOutputDTO {
  jobId: string;
  status: string;
  fileName: string;
  /** Presente só quando o job terminou em FAILED e o worker gravou o motivo. */
  failureReason?: string;
}
