import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type ResourceMetrics } from '@opentelemetry/sdk-metrics';

import { metricsEnabled, otelEnabled } from './flags';
import { createMonitoringMetrics } from './metrics';

class TestReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

type Point = { value: unknown; attributes: Record<string, unknown> };

function pointsOf(resourceMetrics: ResourceMetrics, name: string): Point[] {
  return resourceMetrics.scopeMetrics
    .flatMap(scope => scope.metrics)
    .filter(metric => metric.descriptor.name === name)
    .flatMap(metric => metric.dataPoints.map(point => ({ value: point.value, attributes: point.attributes })));
}

describe('metrics', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DD_METRICS_ENABLED;
    delete process.env.OTEL_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('metricsEnabled and otelEnabled are false by default', () => {
    expect(metricsEnabled()).toBe(false);
    expect(otelEnabled()).toBe(false);
  });

  it.each(['true', '1', 'yes', 'TRUE'])('metricsEnabled accepts %s', flag => {
    process.env.DD_METRICS_ENABLED = flag;
    expect(metricsEnabled()).toBe(true);
  });

  it('otelEnabled only accepts true', () => {
    process.env.OTEL_ENABLED = '1';
    expect(otelEnabled()).toBe(false);
    process.env.OTEL_ENABLED = 'true';
    expect(otelEnabled()).toBe(true);
  });

  it('is a disabled no-op when metrics are off', () => {
    process.env.OTEL_ENABLED = 'true';
    const m = createMonitoringMetrics();

    expect(m.enabled).toBe(false);
    expect(() => {
      m.incrementVideoJobsCreated();
      m.incrementVideoJobsDone();
      m.incrementVideoJobsFailed('x');
      m.captureJobProcessingDuration(10);
      m.recordQueueDepth('uploads', { visible: 1, inFlight: 2 });
      m.recordStuckProcessingJobs(3);
    }).not.toThrow();
  });

  it('is a disabled no-op without the OTel SDK, even with DD_METRICS_ENABLED', () => {
    process.env.DD_METRICS_ENABLED = 'true';
    expect(createMonitoringMetrics().enabled).toBe(false);
  });

  describe('with the SDK on', () => {
    let reader: TestReader;

    beforeEach(() => {
      process.env.DD_METRICS_ENABLED = 'true';
      process.env.OTEL_ENABLED = 'true';
      reader = new TestReader();
      metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    });

    afterEach(() => {
      metrics.disable();
    });

    it('counts jobs and failures by reason', async () => {
      const m = createMonitoringMetrics();
      m.incrementVideoJobsCreated();
      m.incrementVideoJobsDone();
      m.incrementVideoJobsFailed('too_long');
      m.incrementVideoJobsFailed('too_long');
      m.captureJobProcessingDuration(42);

      const { resourceMetrics } = await reader.collect();

      expect(m.enabled).toBe(true);
      expect(pointsOf(resourceMetrics, 'frames.video_jobs.created')).toEqual([{ value: 1, attributes: {} }]);
      expect(pointsOf(resourceMetrics, 'frames.video_jobs.done')).toEqual([{ value: 1, attributes: {} }]);
      expect(pointsOf(resourceMetrics, 'frames.video_jobs.failed')).toEqual([
        { value: 2, attributes: { reason: 'too_long' } }
      ]);
      expect(pointsOf(resourceMetrics, 'frames.video_jobs.processing_duration')).toHaveLength(1);
    });

    it('exports the last queue depth of each queue until the next reading', async () => {
      const m = createMonitoringMetrics();
      m.recordQueueDepth('uploads', { visible: 3, inFlight: 1 });
      m.recordQueueDepth('dlq', { visible: 0, inFlight: 0 });

      const first = await reader.collect();
      const second = await reader.collect();

      for (const { resourceMetrics } of [first, second]) {
        expect(pointsOf(resourceMetrics, 'frames.sqs.messages_visible')).toEqual([
          { value: 3, attributes: { queue: 'uploads' } },
          { value: 0, attributes: { queue: 'dlq' } }
        ]);
        expect(pointsOf(resourceMetrics, 'frames.sqs.messages_in_flight')).toEqual([
          { value: 1, attributes: { queue: 'uploads' } },
          { value: 0, attributes: { queue: 'dlq' } }
        ]);
      }
    });

    it('exports stuck PROCESSING jobs only after the first count', async () => {
      const m = createMonitoringMetrics();

      const before = await reader.collect();
      m.recordStuckProcessingJobs(2);
      const after = await reader.collect();

      expect(pointsOf(before.resourceMetrics, 'frames.video_jobs.stuck_processing')).toEqual([]);
      expect(pointsOf(after.resourceMetrics, 'frames.video_jobs.stuck_processing')).toEqual([
        { value: 2, attributes: {} }
      ]);
    });
  });
});
