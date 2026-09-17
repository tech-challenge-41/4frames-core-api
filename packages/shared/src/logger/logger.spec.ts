import { type Logger as PinoLogger } from 'pino';

import { createLogger, createRootPinoLogger, defaultLogLevel, isTestRuntime, PinoLoggerAdapter } from './index';

function createFakePino(): jest.Mocked<Pick<PinoLogger, 'debug' | 'info' | 'warn' | 'error' | 'child'>> {
  const fake = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  fake.child.mockReturnValue(fake);
  return fake as any;
}

describe('logger', () => {
  describe('PinoLoggerAdapter', () => {
    it('should pass bindings before the message, as pino expects', () => {
      const pino = createFakePino();
      const logger = new PinoLoggerAdapter(pino as unknown as PinoLogger);

      logger.info('hello');
      logger.warn('careful', { jobId: '42' });

      expect(pino.info).toHaveBeenCalledWith('hello');
      expect(pino.warn).toHaveBeenCalledWith({ jobId: '42' }, 'careful');
    });

    it('should attach the error under err', () => {
      const pino = createFakePino();
      const logger = new PinoLoggerAdapter(pino as unknown as PinoLogger);
      const error = new Error('boom');

      logger.error('failed', error, { jobId: '42' });
      logger.error('no details');

      expect(pino.error).toHaveBeenCalledWith({ jobId: '42', err: error }, 'failed');
      expect(pino.error).toHaveBeenCalledWith('no details');
    });

    it('should create children with bindings', () => {
      const pino = createFakePino();
      const child = new PinoLoggerAdapter(pino as unknown as PinoLogger).child({ component: 'Worker' });

      child.debug('tick');

      expect(pino.child).toHaveBeenCalledWith({ component: 'Worker' });
      expect(pino.debug).toHaveBeenCalledWith('tick');
    });
  });

  describe('environment defaults', () => {
    it('should detect the test runtime', () => {
      expect(isTestRuntime({ NODE_ENV: 'test' })).toBe(true);
      expect(isTestRuntime({ JEST_WORKER_ID: '1' })).toBe(true);
      expect(isTestRuntime({ NODE_ENV: 'production' })).toBe(false);
    });

    it('should pick the level by environment', () => {
      expect(defaultLogLevel({ NODE_ENV: 'test' })).toBe('error');
      expect(defaultLogLevel({ NODE_ENV: 'production' })).toBe('info');
      expect(defaultLogLevel({ NODE_ENV: 'development' })).toBe('debug');
    });
  });

  describe('createRootPinoLogger', () => {
    it('should write JSON lines with the mixin and base fields', () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const root = createRootPinoLogger({
        level: 'info',
        mixin: () => ({ requestId: 'req-1' }),
        base: { service: 'api' }
      });
      root.info({ jobId: '42' }, 'job queued');

      const line = JSON.parse(String(write.mock.calls.at(-1)?.[0]));
      write.mockRestore();

      expect(line).toMatchObject({ msg: 'job queued', jobId: '42', requestId: 'req-1', service: 'api', level: 30 });
    });

    it('should use the error level by default under Jest', () => {
      expect(createRootPinoLogger().level).toBe(process.env.LOG_LEVEL ?? 'error');
      expect(createLogger()).toBeInstanceOf(PinoLoggerAdapter);
    });
  });
});
