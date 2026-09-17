import {
  JOB_EVENT_TYPES,
  jobChannel,
  jobProgressKey,
  JOBS_EVENTS_CHANNEL,
  type JobEvent,
  parseJobEvent,
  serializeJobEvent
} from './events';

describe('job events', () => {
  it('should build the Redis channel and progress key names from ADR-001', () => {
    expect(jobChannel(42)).toBe('job:42');
    expect(jobProgressKey('abc')).toBe('progress:abc');
    expect(JOBS_EVENTS_CHANNEL).toBe('jobs.events');
  });

  it.each<JobEvent>([
    { type: JOB_EVENT_TYPES.progress, jobId: '42', userId: 1, percent: 37.5 },
    { type: JOB_EVENT_TYPES.done, jobId: '42', userId: 1, zipKey: 'zips/1/42.zip', frameCount: 45 },
    { type: JOB_EVENT_TYPES.failed, jobId: '42', userId: 1, reason: 'Invalid video' }
  ])('should round-trip a $type event', event => {
    expect(parseJobEvent(serializeJobEvent(event))).toEqual(event);
  });

  it('should refuse to serialize an invalid event', () => {
    expect(() =>
      serializeJobEvent({ type: JOB_EVENT_TYPES.progress, jobId: '42', userId: 1, percent: 150 } as JobEvent)
    ).toThrow();
  });

  it.each(['not json', '{}', JSON.stringify({ type: 'job.unknown', jobId: '1', userId: 1 })])(
    'should return null for a malformed message (%s)',
    raw => {
      expect(parseJobEvent(raw)).toBeNull();
    }
  );
});
