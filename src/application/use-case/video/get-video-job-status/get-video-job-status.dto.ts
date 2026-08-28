export interface GetVideoJobStatusInputDTO {
  userId: number;
  jobId: number;
}

export interface GetVideoJobStatusOutputDTO {
  jobId: number;
  status: string;
  fileName: string;
  // Sempre omitido por ora: video_jobs ainda não tem coluna para o motivo de falha (worker vai gravá-la futuramente).
  failureReason?: string;
}
