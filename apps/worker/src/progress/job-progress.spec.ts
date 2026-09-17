import { clampPercent, extractionPercent, PROGRESS, ProgressThrottle } from './job-progress';

describe('job progress', () => {
  it('should map the ffmpeg ratio into the extraction range', () => {
    expect(extractionPercent(0)).toBe(PROGRESS.extractionStart);
    expect(extractionPercent(0.5)).toBe(45);
    expect(extractionPercent(1)).toBe(PROGRESS.extractionEnd);
    expect(extractionPercent(1.7)).toBe(PROGRESS.extractionEnd);
    expect(extractionPercent(-1)).toBe(PROGRESS.extractionStart);
    expect(extractionPercent(Number.NaN)).toBe(PROGRESS.extractionStart);
  });

  it('should keep stages in increasing order below 100', () => {
    const stages = [PROGRESS.probed, PROGRESS.extractionEnd, PROGRESS.zipped, PROGRESS.uploaded];

    expect([...stages].sort((a, b) => a - b)).toEqual(stages);
    expect(Math.max(...stages)).toBeLessThan(100);
  });

  it('should clamp percentages', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  describe('ProgressThrottle', () => {
    it('should publish at most once per whole percentage point and once per interval', () => {
      let clock = 0;
      const throttle = new ProgressThrottle({ minIntervalMs: 1000, now: () => clock });

      expect(throttle.next(5.4)).toBe(5);
      clock = 500;
      expect(throttle.next(20)).toBeUndefined();
      clock = 1000;
      expect(throttle.next(5.9)).toBeUndefined();
      expect(throttle.next(21.7)).toBe(21);
      clock = 5000;
      expect(throttle.next(21.9)).toBeUndefined();
      expect(throttle.next(10)).toBeUndefined();
      expect(throttle.next(130)).toBe(100);
    });
  });
});
