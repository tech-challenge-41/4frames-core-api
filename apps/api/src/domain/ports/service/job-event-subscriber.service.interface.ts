import { type JobEvent } from '@4frames/shared/jobs';

export interface JobEventSubscription {
  /** Fecha a conexão Redis dedicada desta assinatura. Idempotente. */
  unsubscribe(): Promise<void>;
}

export interface IJobEventSubscriber {
  /**
   * Assina os eventos de um job (canal `job:{jobId}`) e emite, antes de qualquer mensagem nova,
   * um evento de progresso sintético com o último percentual conhecido (se houver) — cobre o
   * cliente que conecta no meio do processamento e ficaria sem dado até a próxima publicação.
   * `userId` (já validado pelo chamador) só é usado para compor esse evento sintético.
   */
  subscribe(jobId: string, userId: number, onEvent: (event: JobEvent) => void): Promise<JobEventSubscription>;
}
