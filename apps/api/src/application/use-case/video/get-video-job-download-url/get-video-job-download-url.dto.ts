export interface GetVideoJobDownloadUrlInputDTO {
  userId: number;
  /** UUID do job. */
  jobId: string;
}

export interface GetVideoJobDownloadUrlOutputDTO {
  downloadUrl: string;
  expiresIn: number;
}
