/**
 * Side-effect entry: inicia o OpenTelemetry. Importe logo depois de `@4frames/shared/env/load` e antes de qualquer
 * outro módulo (`import '@4frames/shared/monitoring/load';`): a instrumentação automática só alcança o que for
 * carregado depois. O `shutdownOtel` sai de `@4frames/shared/monitoring`.
 */
import { startOtel } from './otel';

startOtel();
