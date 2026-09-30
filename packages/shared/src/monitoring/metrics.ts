import { metrics } from '@opentelemetry/api';

import { metricsEnabled, otelEnabled } from './flags';

/** Profundidade de uma fila SQS num instante. */
export interface QueueDepth {
  /** Mensagens à espera de um worker (`ApproximateNumberOfMessages`). */
  visible: number;
  /** Mensagens recebidas e ainda não apagadas (`ApproximateNumberOfMessagesNotVisible`). */
  inFlight: number;
}

/** Métricas de negócio dos jobs de vídeo (OTLP → Datadog). */
export interface MonitoringMetrics {
  /** `false` quando nada é exportado: quem coleta um valor só para medir pode pular o trabalho. */
  readonly enabled: boolean;
  incrementVideoJobsCreated(): void;
  incrementVideoJobsDone(): void;
  /**
   * `reason` vira tag no Datadog, e cada valor distinto é uma série nova: passe um código de um conjunto fixo
   * (`too_long`, `retries_exhausted`…), nunca o texto mostrado ao usuário.
   */
  incrementVideoJobsFailed(reason?: string): void;
  captureJobProcessingDuration(durationInMilliseconds: number): void;
  /** Última leitura da fila `queue` (`uploads`, `dlq`), exportada como gauge até a próxima. */
  recordQueueDepth(queue: string, depth: QueueDepth): void;
  /** Jobs em PROCESSING sem escrita recente, contados pela rotina de expiração. */
  recordStuckProcessingJobs(count: number): void;
}

const noop: MonitoringMetrics = {
  enabled: false,
  incrementVideoJobsCreated() {},
  incrementVideoJobsDone() {},
  incrementVideoJobsFailed() {},
  captureJobProcessingDuration() {},
  recordQueueDepth() {},
  recordStuckProcessingJobs() {}
};

class OtelMetrics implements MonitoringMetrics {
  public readonly enabled = true;
  private readonly meter = metrics.getMeter('4frames');
  // Nomes devem começar com letra (Datadog rejeita `4frames.*`).
  private readonly jobsCreated = this.meter.createCounter('frames.video_jobs.created');
  private readonly jobsDone = this.meter.createCounter('frames.video_jobs.done');
  private readonly jobsFailed = this.meter.createCounter('frames.video_jobs.failed');
  private readonly processingDuration = this.meter.createHistogram('frames.video_jobs.processing_duration', {
    unit: 'ms'
  });

  // Os gauges exportam a última leitura a cada coleta do SDK, mesmo que a leitura seja menos frequente.
  private readonly queueDepths = new Map<string, QueueDepth>();
  private stuckProcessing: number | undefined;

  constructor() {
    this.meter.createObservableGauge('frames.sqs.messages_visible').addCallback(result => {
      for (const [queue, depth] of this.queueDepths) {
        result.observe(depth.visible, { queue });
      }
    });
    this.meter.createObservableGauge('frames.sqs.messages_in_flight').addCallback(result => {
      for (const [queue, depth] of this.queueDepths) {
        result.observe(depth.inFlight, { queue });
      }
    });
    this.meter.createObservableGauge('frames.video_jobs.stuck_processing').addCallback(result => {
      if (this.stuckProcessing !== undefined) {
        result.observe(this.stuckProcessing);
      }
    });
  }

  public incrementVideoJobsCreated(): void {
    this.jobsCreated.add(1);
  }

  public incrementVideoJobsDone(): void {
    this.jobsDone.add(1);
  }

  public incrementVideoJobsFailed(reason?: string): void {
    this.jobsFailed.add(1, reason ? { reason } : undefined);
  }

  public captureJobProcessingDuration(durationInMilliseconds: number): void {
    this.processingDuration.record(durationInMilliseconds);
  }

  public recordQueueDepth(queue: string, depth: QueueDepth): void {
    this.queueDepths.set(queue, { ...depth });
  }

  public recordStuckProcessingJobs(count: number): void {
    this.stuckProcessing = count;
  }
}

/**
 * Métricas reais só com `DD_METRICS_ENABLED` e o SDK ligado (`OTEL_ENABLED=true`); senão, uma implementação que não
 * faz nada. Crie uma vez por processo, depois do `monitoring/load`, e passe a mesma instância a quem precisar: cada
 * instância registra os próprios gauges.
 */
export function createMonitoringMetrics(): MonitoringMetrics {
  if (!metricsEnabled() || !otelEnabled()) return noop;
  return new OtelMetrics();
}
