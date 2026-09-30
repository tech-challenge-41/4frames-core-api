import { createMonitoringMetrics, metricsEnabled } from './metrics';

describe('metrics', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DD_METRICS_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('metricsEnabled is false by default', () => {
    expect(metricsEnabled()).toBe(false);
  });

  it.each(['true', '1', 'yes', 'TRUE'])('metricsEnabled accepts %s', flag => {
    process.env.DD_METRICS_ENABLED = flag;
    expect(metricsEnabled()).toBe(true);
  });

  it('noop service does not throw when metrics are off', () => {
    const m = createMonitoringMetrics();
    expect(() => {
      m.incrementVideoJobsCreated();
      m.incrementVideoJobsDone();
      m.incrementVideoJobsFailed('x');
      m.captureJobProcessingDuration(10);
    }).not.toThrow();
  });

  it('otel service records when metrics are on', () => {
    process.env.DD_METRICS_ENABLED = 'true';
    const m = createMonitoringMetrics();
    expect(() => {
      m.incrementVideoJobsCreated();
      m.incrementVideoJobsDone();
      m.incrementVideoJobsFailed('invalid');
      m.captureJobProcessingDuration(42);
    }).not.toThrow();
  });
});
