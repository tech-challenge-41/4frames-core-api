export interface CreateVideoJobInputDTO {
  userId: number;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface CreateVideoJobOutputDTO {
  jobId: number;
  uploadUrl: string;
  expiresIn: number;
}
