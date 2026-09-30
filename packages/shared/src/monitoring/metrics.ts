import { metrics } from '@opentelemetry/api';

/** Métricas de negócio dos jobs de vídeo (OTLP → Datadog). */
export interface MonitoringMetrics {
  incrementVideoJobsCreated(): void;
  incrementVideoJobsDone(): void;
  incrementVideoJobsFailed(reason?: string): void;
  captureJobProcessingDuration(durationInMilliseconds: number): void;
}

const noop: MonitoringMetrics = {
  incrementVideoJobsCreated() {},
  incrementVideoJobsDone() {},
  incrementVideoJobsFailed() {},
  captureJobProcessingDuration() {}
};

class OtelMetrics implements MonitoringMetrics {
  private readonly meter = metrics.getMeter('4frames');
  // Nomes devem começar com letra (Datadog rejeita `4frames.*`).
  private readonly jobsCreated = this.meter.createCounter('frames.video_jobs.created');
  private readonly jobsDone = this.meter.createCounter('frames.video_jobs.done');
  private readonly jobsFailed = this.meter.createCounter('frames.video_jobs.failed');
  private readonly processingDuration = this.meter.createHistogram('frames.video_jobs.processing_duration');

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
}

export function metricsEnabled(): boolean {
  const flag = process.env.DD_METRICS_ENABLED?.trim().toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes';
}

export function createMonitoringMetrics(): MonitoringMetrics {
  if (!metricsEnabled()) return noop;
  return new OtelMetrics();
}
