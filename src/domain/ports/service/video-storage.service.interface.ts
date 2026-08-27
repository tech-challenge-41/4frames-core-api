export interface PresignedUploadUrl {
  uploadUrl: string;
  expiresIn: number;
}

export interface IVideoStorageService {
  generatePresignedUploadUrl(key: string, contentType: string, expiresIn: number): Promise<PresignedUploadUrl>;
}
