/** `OTEL_ENABLED=true` liga o SDK do OpenTelemetry (traces, logs e métricas). */
export function otelEnabled(): boolean {
  return process.env.OTEL_ENABLED === 'true';
}

/** `DD_METRICS_ENABLED` liga as métricas de negócio (`frames.*`). Só têm efeito com o SDK ligado. */
export function metricsEnabled(): boolean {
  const flag = process.env.DD_METRICS_ENABLED?.trim().toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes';
}
