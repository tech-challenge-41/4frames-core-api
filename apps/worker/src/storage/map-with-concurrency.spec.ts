import { mapWithConcurrency } from './map-with-concurrency';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });

  return { promise, resolve };
}

describe('mapWithConcurrency', () => {
  it('should run every item without exceeding the concurrency', async () => {
    let running = 0;
    let maxRunning = 0;
    const done: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async item => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      done.push(item);
      running--;
    });

    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxRunning).toBe(3);
  });

  it('should stop starting new items after a failure and reject with that error', async () => {
    const started: number[] = [];
    const gate = deferred();

    const run = mapWithConcurrency([1, 2, 3, 4], 2, async item => {
      started.push(item);

      if (item === 1) {
        throw new Error('upload failed');
      }

      await gate.promise;
    });

    await new Promise(resolve => setImmediate(resolve));
    gate.resolve();

    await expect(run).rejects.toThrow('upload failed');
    expect(started).toEqual([1, 2]);
  });

  it('should resolve for an empty list', async () => {
    const task = jest.fn();

    await expect(mapWithConcurrency([], 4, task)).resolves.toBeUndefined();
    expect(task).not.toHaveBeenCalled();
  });
});
