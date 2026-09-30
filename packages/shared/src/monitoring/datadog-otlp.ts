import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { type PushMetricExporter } from '@opentelemetry/sdk-metrics';

export enum OTLPExporterType {
  TRACES = 'traces',
  LOGS = 'logs',
  METRICS = 'metrics'
}

/**
 * Exportadores OTLP HTTP para o Datadog Agent (Compose/Kind) ou o endpoint OTLP na nuvem.
 * Mesmo contrato do garagio-api: `OTEL_EXPORTER_OTLP_TARGET=agent` → host:4318 sem API key no app.
 */
export class DatadogOTLPExporter {
  constructor() {
    this.validateConfig();
  }

  public createMetricExporter(): PushMetricExporter {
    const exporter = new OTLPMetricExporter({
      url: this.getUrl(OTLPExporterType.METRICS),
      headers: this.getHeaders(),
      temporalityPreference: AggregationTemporalityPreference.DELTA
    });

    return {
      export: (resourceMetrics, resultCallback) => {
        exporter.export(resourceMetrics, result => {
          if (result.error) {
            console.error('[OTLP metrics export]', result.error);
          }

          resultCallback(result);
        });
      },
      shutdown: () => exporter.shutdown(),
      forceFlush: () => exporter.forceFlush(),
      selectAggregation: exporter.selectAggregation.bind(exporter),
      selectAggregationTemporality: exporter.selectAggregationTemporality.bind(exporter)
    };
  }

  public createLogExporter(): OTLPLogExporter {
    return new OTLPLogExporter({
      url: this.getUrl(OTLPExporterType.LOGS),
      headers: this.getHeaders()
    });
  }

  public createTraceExporter(): OTLPTraceExporter {
    return new OTLPTraceExporter({
      url: this.getUrl(OTLPExporterType.TRACES),
      headers: this.getHeaders()
    });
  }

  public getUrl(type: OTLPExporterType): string {
    if (this.isAgentTarget()) {
      const host = process.env.DD_AGENT_HOST ?? 'datadog-agent';
      return `http://${host}:4318/v1/${type}`;
    }

    return `https://${this.getHost()}/v1/${type}`;
  }

  public getHost(): string {
    if (this.isAgentTarget()) {
      return process.env.DD_AGENT_HOST ?? 'datadog-agent';
    }

    return `otlp.${process.env.DD_SITE}`;
  }

  public getHeaders(): Record<string, string> {
    if (this.isAgentTarget()) {
      return {};
    }

    return {
      'dd-api-key': process.env.DD_API_KEY ?? ''
    };
  }

  public isAgentTarget(): boolean {
    return process.env.OTEL_EXPORTER_OTLP_TARGET === 'agent';
  }

  private validateConfig(): void {
    if (this.isAgentTarget()) {
      return;
    }

    if (!process.env.DD_API_KEY) {
      throw new Error('DD_API_KEY is not set');
    }

    if (!process.env.DD_SITE) {
      throw new Error('DD_SITE is not set');
    }
  }
}
