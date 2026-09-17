export interface CompleteVideoJobInputDTO {
  userId: number;
  jobId: number;
}

export interface CompleteVideoJobOutputDTO {
  jobId: number;
  status: string;
  fileName: string;
}
