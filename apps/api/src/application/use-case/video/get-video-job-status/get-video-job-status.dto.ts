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
  /** Percentual (0–100) do processamento. Só em PROCESSING, e só depois de o worker publicar o primeiro. */
  progress?: number;
}
