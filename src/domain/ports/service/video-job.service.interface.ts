export interface VideoJobRecord {
  id: number;
  userId: number;
  fileName: string;
  status: string;
}

export interface IVideoJobService {
  createUploadPendingJob(userId: number, fileName: string): Promise<VideoJobRecord>;
}
