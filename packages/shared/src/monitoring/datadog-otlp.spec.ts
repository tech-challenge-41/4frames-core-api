import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { DatadogOTLPExporter, OTLPExporterType } from './datadog-otlp';

describe('datadog-otlp', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DD_API_KEY;
    delete process.env.DD_SITE;
    delete process.env.OTEL_EXPORTER_OTLP_TARGET;
    delete process.env.DD_AGENT_HOST;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws when DD_API_KEY is missing for cloud target', () => {
    expect(() => new DatadogOTLPExporter()).toThrow('DD_API_KEY is not set');
  });

  it('throws when DD_SITE is missing for cloud target', () => {
    process.env.DD_API_KEY = 'test-key';
    expect(() => new DatadogOTLPExporter()).toThrow('DD_SITE is not set');
  });

  it('creates traces exporter', () => {
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'us5.datadoghq.com';
    expect(new DatadogOTLPExporter().createTraceExporter()).toBeInstanceOf(OTLPTraceExporter);
  });

  it('creates logs exporter', () => {
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'us5.datadoghq.com';
    expect(new DatadogOTLPExporter().createLogExporter()).toBeInstanceOf(OTLPLogExporter);
  });

  it('creates metrics exporter', () => {
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'us5.datadoghq.com';
    const exporter = new DatadogOTLPExporter().createMetricExporter();
    expect(exporter).toEqual(
      expect.objectContaining({
        export: expect.any(Function),
        shutdown: expect.any(Function),
        forceFlush: expect.any(Function)
      })
    );
  });

  it('uses agent OTLP endpoint when OTEL_EXPORTER_OTLP_TARGET=agent', () => {
    process.env.OTEL_EXPORTER_OTLP_TARGET = 'agent';
    process.env.DD_AGENT_HOST = 'datadog-agent';
    const dd = new DatadogOTLPExporter();
    expect(dd.getUrl(OTLPExporterType.TRACES)).toBe('http://datadog-agent:4318/v1/traces');
    expect(dd.getUrl(OTLPExporterType.LOGS)).toBe('http://datadog-agent:4318/v1/logs');
    expect(dd.getUrl(OTLPExporterType.METRICS)).toBe('http://datadog-agent:4318/v1/metrics');
    expect(dd.getHeaders()).toEqual({});
    expect(dd.getHost()).toBe('datadog-agent');
    expect(dd.isAgentTarget()).toBe(true);
  });

  it('defaults DD_AGENT_HOST to datadog-agent', () => {
    process.env.OTEL_EXPORTER_OTLP_TARGET = 'agent';
    delete process.env.DD_AGENT_HOST;
    const dd = new DatadogOTLPExporter();
    expect(dd.getHost()).toBe('datadog-agent');
    expect(dd.getUrl(OTLPExporterType.TRACES)).toBe('http://datadog-agent:4318/v1/traces');
  });

  it('builds cloud URLs and headers', () => {
    process.env.DD_API_KEY = 'test-key';
    process.env.DD_SITE = 'us5.datadoghq.com';
    const dd = new DatadogOTLPExporter();
    expect(dd.getHost()).toBe('otlp.us5.datadoghq.com');
    expect(dd.getUrl(OTLPExporterType.TRACES)).toBe('https://otlp.us5.datadoghq.com/v1/traces');
    expect(dd.getHeaders()).toEqual({ 'dd-api-key': 'test-key' });
  });
});
