/**
 * Motivos gravados em `video_jobs.failure_reason`. São mostrados ao usuário (front e e-mail), por isso em português.
 */
export const FAILURE_REASONS = {
  invalidVideo: 'O arquivo enviado não é um vídeo válido',
  noVideoStream: 'O arquivo enviado não contém uma trilha de vídeo',
  unsupportedFormat: 'Formato de vídeo não suportado. Envie um arquivo MP4 ou MOV',
  unknownDuration: 'Não foi possível identificar a duração do vídeo',
  noFrames: 'Nenhum frame foi extraído do vídeo',
  sourceNotFound: 'O vídeo enviado não foi encontrado no armazenamento',
  retriesExhausted: 'Falha após 3 tentativas',
  tooLong: (durationSeconds: number, maxSeconds: number) =>
    `O vídeo tem ${Math.ceil(durationSeconds)} s e excede o limite de ${maxSeconds} s`
} as const;

/**
 * Falha definitiva causada pelo próprio vídeo: o job vai para FAILED e a mensagem é apagada.
 * Qualquer outro erro é tratado como transiente e a mensagem volta à fila.
 */
export class InvalidVideoError extends Error {
  public readonly reason: string;
  /** Detalhe técnico para o log (ex.: fim do stderr do ffmpeg). Nunca vai para o usuário. */
  public readonly details?: string;

  constructor(reason: string, details?: string) {
    super(reason);
    this.name = 'InvalidVideoError';
    this.reason = reason;
    this.details = details;
  }
}

export function isInvalidVideoError(error: unknown): error is InvalidVideoError {
  return error instanceof InvalidVideoError;
}

/** O objeto não existe no bucket. */
export class ObjectNotFoundError extends Error {
  public readonly key: string;

  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
    this.key = key;
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
