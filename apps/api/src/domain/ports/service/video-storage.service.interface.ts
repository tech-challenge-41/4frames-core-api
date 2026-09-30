export interface PresignedUploadUrl {
  uploadUrl: string;
  expiresIn: number;
}

export interface PresignedDownloadUrl {
  downloadUrl: string;
  expiresIn: number;
}

export interface IVideoStorageService {
  generatePresignedUploadUrl(key: string, contentType: string, expiresIn: number): Promise<PresignedUploadUrl>;
  generatePresignedDownloadUrl(key: string, expiresIn: number): Promise<PresignedDownloadUrl>;
  headObject(key: string): Promise<boolean>;
}
