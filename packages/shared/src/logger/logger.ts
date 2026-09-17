export type LogBindings = Record<string, unknown>;

/**
 * Contrato de logger usado pelos apps. A API mantém a própria porta de domínio (ILogger)
 * com o mesmo formato; os dois são estruturalmente compatíveis.
 */
export interface Logger {
  child(bindings: LogBindings): Logger;
  debug(message: string, bindings?: LogBindings): void;
  info(message: string, bindings?: LogBindings): void;
  warn(message: string, bindings?: LogBindings): void;
  error(message: string, error?: Error, bindings?: LogBindings): void;
}
