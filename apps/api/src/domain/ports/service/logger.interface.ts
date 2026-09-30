export type LogBindings = Record<string, unknown>;

export const LOGGER_KEY = 'Logger' as const;

export interface ILogger {
  child(bindings: LogBindings): ILogger;
  debug(message: string, bindings?: LogBindings): void;
  info(message: string, bindings?: LogBindings): void;
  warn(message: string, bindings?: LogBindings): void;
  error(message: string, error?: Error, bindings?: LogBindings): void;
}
