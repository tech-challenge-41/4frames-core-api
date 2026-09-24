export interface CancelVideoJobInputDTO {
  userId: number;
  /** UUID do job. */
  jobId: string;
}

export interface CancelVideoJobOutputDTO {
  jobId: string;
  status: string;
}
