import { SseStreamRegistry } from '../sse-stream-registry';

describe('SseStreamRegistry', () => {
  let registry: SseStreamRegistry;

  beforeEach(() => {
    registry = new SseStreamRegistry();
  });

  it('should close every open stream and report how many there were', async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    registry.register(first);
    registry.register(second);

    await expect(registry.closeAll()).resolves.toBe(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('should not close a stream that already left the registry', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const unregister = registry.register(close);

    unregister();

    await expect(registry.closeAll()).resolves.toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('should wait for the streams to release their resources', async () => {
    let released = false;
    registry.register(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      released = true;
    });

    await registry.closeAll();

    expect(released).toBe(true);
  });

  it('should keep closing the other streams when one of them fails', async () => {
    const healthy = jest.fn().mockResolvedValue(undefined);
    registry.register(jest.fn().mockRejectedValue(new Error('redis quit failed')));
    registry.register(healthy);

    await expect(registry.closeAll()).resolves.toBe(2);
    expect(healthy).toHaveBeenCalled();
  });

  it('should close a stream opened during the shutdown right away', async () => {
    await registry.closeAll();
    const close = jest.fn().mockResolvedValue(undefined);

    registry.register(close);

    expect(close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
