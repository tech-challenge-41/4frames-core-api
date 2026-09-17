import { type Logger as PinoLogger } from 'pino';

import { type LogBindings, type Logger } from './logger';

type PinoLogLevel = 'debug' | 'info' | 'warn' | 'error';

export class PinoLoggerAdapter implements Logger {
  constructor(private readonly log: PinoLogger) {}

  public child(bindings: LogBindings): Logger {
    return new PinoLoggerAdapter(this.log.child(bindings));
  }

  public debug(message: string, bindings?: LogBindings): void {
    this.emit('debug', message, bindings);
  }

  public info(message: string, bindings?: LogBindings): void {
    this.emit('info', message, bindings);
  }

  public warn(message: string, bindings?: LogBindings): void {
    this.emit('warn', message, bindings);
  }

  public error(message: string, error?: Error, bindings?: LogBindings): void {
    const payload: LogBindings = { ...bindings };

    if (error !== undefined) {
      payload.err = error;
    }

    this.emit('error', message, Object.keys(payload).length > 0 ? payload : undefined);
  }

  private emit(level: PinoLogLevel, message: string, bindings?: LogBindings): void {
    if (bindings === undefined) {
      this.log[level](message);
    } else {
      this.log[level](bindings, message);
    }
  }
}
