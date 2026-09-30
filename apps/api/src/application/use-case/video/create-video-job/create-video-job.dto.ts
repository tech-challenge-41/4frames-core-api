export interface CreateVideoJobInputDTO {
  userId: number;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface CreateVideoJobOutputDTO {
  /** UUID do job. */
  jobId: string;
  uploadUrl: string;
  expiresIn: number;
}
