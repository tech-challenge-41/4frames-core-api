export interface ExpireAbandonedUploadsOutputDTO {
  /** Jobs em UPLOAD_PENDING que passaram a EXPIRED nesta passada. */
  expired: number;
  /** Corte usado: jobs criados antes disto e ainda sem upload confirmado expiraram. */
  createdBefore: Date;
  /** Jobs em PROCESSING sem nenhuma escrita há mais de 15 min. Só é contado e registrado no log. */
  stuckProcessing: number;
}
