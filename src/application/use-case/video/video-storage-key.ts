const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov'
};

export function contentTypeToExtension(contentType: string): string | undefined {
  return CONTENT_TYPE_TO_EXTENSION[contentType];
}

export function buildVideoSourceKey(userId: number, jobId: number, extension: string): string {
  return `videos/${userId}/${jobId}/source.${extension}`;
}
