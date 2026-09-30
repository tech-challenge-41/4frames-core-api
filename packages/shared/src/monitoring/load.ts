/**
 * Side-effect entry: start the OpenTelemetry SDK (import after `@4frames/shared/env/load`).
 * Re-exports shutdown helpers for graceful shutdown.
 */
import './otel';

export { otelEnabled, shutdownOtel } from './otel';
