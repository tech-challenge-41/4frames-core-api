import { type Logger } from '@4frames/shared/logger';
import { type MonitoringMetrics } from '@4frames/shared/monitoring';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';

import { toError } from '../processing/errors';

/** A cada 15 s: o painel não precisa da cadência do KEDA, que consulta a fila a cada 5 s. */
export const QUEUE_DEPTH_INTERVAL_MS = 15_000;

export interface MonitoredQueue {
  /** Valor da tag `queue` no Datadog (`uploads`, `dlq`). */
  name: string;
  url: string;
}

export interface QueueDepthMonitorOptions {
  sqs: Pick<SQSClient, 'send'>;
  queues: MonitoredQueue[];
  monitoring: MonitoringMetrics;
  logger: Logger;
  intervalMs?: number;
}

/**
 * Lê a profundidade das filas no SQS e a entrega às métricas (`frames.sqs.messages_visible` e `_in_flight`). Nenhum
 * outro componente manda a fila ao Datadog: o KEDA a lê só para escalar, e o Agent não enxerga o LocalStack. Cada
 * réplica do worker publica a mesma leitura; no Datadog, agregue com `max`. Uma leitura que falha só é registrada.
 */
export class QueueDepthMonitor {
  private readonly sqs: Pick<SQSClient, 'send'>;
  private readonly queues: MonitoredQueue[];
  private readonly monitoring: MonitoringMetrics;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor({ sqs, queues, monitoring, logger, intervalMs = QUEUE_DEPTH_INTERVAL_MS }: QueueDepthMonitorOptions) {
    this.sqs = sqs;
    this.queues = queues;
    this.monitoring = monitoring;
    this.logger = logger;
    this.intervalMs = intervalMs;
  }

  /** Começa a ler a cada `intervalMs`. Sem métricas ligadas, não faz nada. */
  public start(): void {
    if (!this.monitoring.enabled || this.timer) {
      return;
    }

    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    // O timer não segura o processo: quem decide a saída é o encerramento gracioso.
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async poll(): Promise<void> {
    await Promise.all(this.queues.map(queue => this.read(queue)));
  }

  private async read({ name, url }: MonitoredQueue): Promise<void> {
    try {
      const { Attributes: attributes = {} } = await this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
        })
      );

      this.monitoring.recordQueueDepth(name, {
        visible: Number(attributes.ApproximateNumberOfMessages ?? 0),
        inFlight: Number(attributes.ApproximateNumberOfMessagesNotVisible ?? 0)
      });
    } catch (error) {
      this.logger.warn('Queue depth read failed', { queue: name, error: toError(error).message });
    }
  }
}
