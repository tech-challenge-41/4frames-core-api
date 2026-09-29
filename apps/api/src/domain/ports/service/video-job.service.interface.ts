export interface VideoJobRecord {
  /** UUID gerado pelo banco. */
  id: string;
  userId: number;
  fileName: string;
  contentType: string;
  /** Tamanho declarado na criação do job, em bytes. */
  fileSize: number;
  status: string;
  /** Preenchido pelo worker quando o job termina em FAILED. */
  failureReason: string | null;
  /** Chave S3 do .zip gerado, preenchida pelo worker quando o job termina em DONE. */
  zipKey: string | null;
  createdAt: Date;
}

export interface CreateUploadPendingJobInput {
  userId: number;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface ListByUserPagination {
  limit: number;
  offset: number;
}

export interface ListByUserResult {
  items: VideoJobRecord[];
  total: number;
}

export interface IVideoJobService {
  createUploadPendingJob(input: CreateUploadPendingJobInput): Promise<VideoJobRecord>;
  findById(jobId: string): Promise<VideoJobRecord | null>;
  listByUser(userId: number, pagination: ListByUserPagination): Promise<ListByUserResult>;
  /**
   * Confirma o upload levando o job de UPLOAD_PENDING a QUEUED com escrita condicional (`updateMany` restrito a
   * UPLOAD_PENDING do próprio dono), sem pisar num cancelamento ou numa expiração concorrente. Retorna `null`
   * quando a condição não bateu — job de outro dono, inexistente, ou que já saiu de UPLOAD_PENDING.
   */
  queueIfUploadPending(jobId: string, userId: number): Promise<VideoJobRecord | null>;
  /**
   * Cancela o job com escrita condicional (`updateMany` restrito a UPLOAD_PENDING/QUEUED do próprio
   * dono), evitando pisar numa transição concorrente do worker (ex.: markProcessing). Retorna `null`
   * quando a condição não bateu — job de outro dono, inexistente, ou já capturado pelo worker.
   */
  cancelIfPending(jobId: string, userId: number): Promise<VideoJobRecord | null>;
  /**
   * Marca como EXPIRED, numa única escrita condicional, os jobs ainda em UPLOAD_PENDING criados antes de
   * `createdBefore`. Um job que o `complete` levou a QUEUED no mesmo instante fica de fora. Devolve quantos
   * expiraram.
   */
  expireUploadPendingCreatedBefore(createdBefore: Date): Promise<number>;
  /** Quantos jobs estão em PROCESSING sem nenhuma escrita desde `updatedBefore`: worker parado ou travado. */
  countProcessingNotUpdatedSince(updatedBefore: Date): Promise<number>;
}
