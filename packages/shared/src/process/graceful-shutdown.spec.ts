import { EventEmitter } from 'node:events';

import { registerGracefulShutdown } from './graceful-shutdown';
import { type Logger } from '../logger/logger';

function createLogger(): jest.Mocked<Logger> {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return logger;
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('registerGracefulShutdown', () => {
  let source: EventEmitter;
  let logger: jest.Mocked<Logger>;
  let exit: jest.Mock;

  beforeEach(() => {
    source = new EventEmitter();
    logger = createLogger();
    exit = jest.fn();
  });

  it('should run onShutdown once and exit with 0 on the first signal', async () => {
    const onShutdown = jest.fn().mockResolvedValue(undefined);
    registerGracefulShutdown({ logger, onShutdown, exit, source: source as unknown as NodeJS.Process });

    source.emit('SIGTERM', 'SIGTERM');
    await flush();

    expect(onShutdown).toHaveBeenCalledWith('SIGTERM');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('should exit with 1 when onShutdown fails', async () => {
    const onShutdown = jest.fn().mockRejectedValue(new Error('boom'));
    registerGracefulShutdown({ logger, onShutdown, exit, source: source as unknown as NodeJS.Process });

    source.emit('SIGINT', 'SIGINT');
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith('Shutdown failed', expect.any(Error), { signal: 'SIGINT' });
  });

  it('should exit with 1 when onShutdown exceeds the timeout', async () => {
    const onShutdown = jest.fn(() => new Promise<void>(() => undefined));
    registerGracefulShutdown({ logger, onShutdown, exit, timeoutMs: 5, source: source as unknown as NodeJS.Process });

    source.emit('SIGTERM', 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('should force exit with 1 on a second signal while shutting down', () => {
    const onShutdown = jest.fn(() => new Promise<void>(() => undefined));
    registerGracefulShutdown({
      logger,
      onShutdown,
      exit,
      timeoutMs: 1000,
      source: source as unknown as NodeJS.Process
    });

    source.emit('SIGTERM', 'SIGTERM');
    source.emit('SIGINT', 'SIGINT');

    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('should remove its listeners when unregistered', () => {
    const unregister = registerGracefulShutdown({
      logger,
      onShutdown: jest.fn(),
      exit,
      source: source as unknown as NodeJS.Process
    });

    expect(source.listenerCount('SIGTERM')).toBe(1);
    unregister();
    expect(source.listenerCount('SIGTERM')).toBe(0);
    expect(source.listenerCount('SIGINT')).toBe(0);
  });
});
