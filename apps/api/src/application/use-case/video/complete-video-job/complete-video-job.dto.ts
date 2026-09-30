export interface CompleteVideoJobInputDTO {
  userId: number;
  /** UUID do job. */
  jobId: string;
}

export interface CompleteVideoJobOutputDTO {
  jobId: string;
  status: string;
  fileName: string;
}
