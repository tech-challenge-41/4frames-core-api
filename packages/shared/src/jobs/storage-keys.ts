/** Identificadores aceitos nas chaves. O jobId passa de número para UUID na migration v2 de video_jobs. */
export type JobId = number | string;
export type OwnerId = number | string;

const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov'
};

export const SUPPORTED_VIDEO_CONTENT_TYPES = Object.keys(CONTENT_TYPE_TO_EXTENSION);

/** Prefixo filtrado pela notificação S3 → SQS. Gravações em frames/ e zips/ não geram eventos. */
export const VIDEO_SOURCE_PREFIX = 'videos/';
export const FRAMES_PREFIX = 'frames/';
export const ZIPS_PREFIX = 'zips/';

export function contentTypeToExtension(contentType: string): string | undefined {
  return CONTENT_TYPE_TO_EXTENSION[contentType];
}

export function buildVideoSourceKey(userId: OwnerId, jobId: JobId, extension: string): string {
  return `${VIDEO_SOURCE_PREFIX}${userId}/${jobId}/source.${extension}`;
}

export interface VideoSourceKeyParts {
  userId: string;
  jobId: string;
  extension: string;
}

const VIDEO_SOURCE_KEY_PATTERN = /^videos\/([^/]+)\/([^/]+)\/source\.([a-z0-9]+)$/i;

/** Extrai dono e job da chave do objeto (a chave de um evento S3 precisa ser decodificada antes). */
export function parseVideoSourceKey(key: string): VideoSourceKeyParts | null {
  const match = VIDEO_SOURCE_KEY_PATTERN.exec(key);

  if (!match) {
    return null;
  }

  const [, userId, jobId, extension] = match;

  return { userId: userId!, jobId: jobId!, extension: extension!.toLowerCase() };
}

export function buildZipKey(userId: OwnerId, jobId: JobId): string {
  return `${ZIPS_PREFIX}${userId}/${jobId}.zip`;
}

/** Mesmo padrão do projeto base: frame_0001.png, frame_0002.png… */
export function buildFrameFileName(index: number, format = 'png'): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError(`Frame index must be a positive integer, received ${index}`);
  }

  return `frame_${String(index).padStart(4, '0')}.${format}`;
}

export function buildFrameKey(userId: OwnerId, jobId: JobId, frameFileName: string): string {
  return `${FRAMES_PREFIX}${userId}/${jobId}/${frameFileName}`;
}
