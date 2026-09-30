import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { DatadogOTLPExporter, OTLPExporterType } from './datadog-otlp';

export const otelEnabled = (): boolean => process.env.OTEL_ENABLED === 'true';

let sdkInstance: NodeSDK | undefined;

/**
 * Encerra o SDK (flush de traces/logs/métricas). Chamar no graceful shutdown dos apps —
 * não registra SIGTERM aqui para não brigar com `registerGracefulShutdown`.
 */
export async function shutdownOtel(): Promise<void> {
  if (sdkInstance === undefined) {
    return;
  }

  try {
    await sdkInstance.shutdown();
    console.log('OpenTelemetry shutdown');
  } catch (error) {
    console.error('Error shutting down OpenTelemetry:', error);
  } finally {
    sdkInstance = undefined;
  }
}

(() => {
  if (!otelEnabled()) {
    console.log('OpenTelemetry disabled');
    return;
  }

  let exporter: DatadogOTLPExporter;

  try {
    exporter = new DatadogOTLPExporter();
  } catch (error) {
    console.error('Error creating Datadog OTLP exporter:', error);
    return;
  }

  const metricsOn = process.env.OTEL_METRICS_EXPORTER !== 'none';

  const sdk = new NodeSDK({
    resource: new Resource({
      'service.name': process.env.OTEL_SERVICE_NAME || process.env.DD_SERVICE || '4frames',
      'deployment.environment': process.env.APP_ENV || process.env.NODE_ENV || 'development',
      'service.version': process.env.OTEL_SERVICE_VERSION || process.env.DD_VERSION || '1.0.0'
    }),
    traceExporter: exporter.createTraceExporter(),
    logRecordProcessors: [new BatchLogRecordProcessor(exporter.createLogExporter())],
    metricReader: metricsOn
      ? new PeriodicExportingMetricReader({
          exporter: exporter.createMetricExporter(),
          exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS) || 5_000
        })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-pino': {
          enabled: true,
          disableLogCorrelation: false,
          disableLogSending: false
        },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-pg': { enabled: true }
      })
    ]
  });

  try {
    sdk.start();
    sdkInstance = sdk;
    const target = exporter.isAgentTarget() ? 'agent' : 'cloud';
    console.log(`OpenTelemetry started (OTLP → Datadog ${target}, host ${exporter.getHost()})`);
    console.log(`  traces:  ${exporter.getUrl(OTLPExporterType.TRACES)}`);
    console.log(`  logs:    ${exporter.getUrl(OTLPExporterType.LOGS)}`);
    if (metricsOn) console.log(`  metrics: ${exporter.getUrl(OTLPExporterType.METRICS)}`);
  } catch (error) {
    console.error('Error starting OpenTelemetry:', error);
  }
})();
