import {
  JOB_EVENT_TYPES,
  jobChannel,
  jobProgressKey,
  JOBS_EVENTS_CHANNEL,
  type JobEvent,
  parseJobEvent,
  serializeJobEvent
} from './events';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

describe('job events', () => {
  it('should build the Redis channel and progress key names from ADR-001', () => {
    expect(jobChannel(JOB_ID)).toBe(`job:${JOB_ID}`);
    expect(jobProgressKey(JOB_ID)).toBe(`progress:${JOB_ID}`);
    expect(JOBS_EVENTS_CHANNEL).toBe('jobs.events');
  });

  it.each<JobEvent>([
    { type: JOB_EVENT_TYPES.progress, jobId: JOB_ID, userId: 1, percent: 37.5 },
    { type: JOB_EVENT_TYPES.done, jobId: JOB_ID, userId: 1, zipKey: `zips/1/${JOB_ID}.zip`, frameCount: 45 },
    { type: JOB_EVENT_TYPES.failed, jobId: JOB_ID, userId: 1, reason: 'Invalid video' }
  ])('should round-trip a $type event', event => {
    expect(parseJobEvent(serializeJobEvent(event))).toEqual(event);
  });

  it('should refuse to serialize an invalid event', () => {
    expect(() =>
      serializeJobEvent({ type: JOB_EVENT_TYPES.progress, jobId: JOB_ID, userId: 1, percent: 150 } as JobEvent)
    ).toThrow();
  });

  it.each([
    'not json',
    '{}',
    JSON.stringify({ type: 'job.unknown', jobId: JOB_ID, userId: 1 }),
    JSON.stringify({ type: 'job.failed', jobId: '42', userId: 1, reason: 'jobId is not a uuid' })
  ])('should return null for a malformed message (%s)', raw => {
    expect(parseJobEvent(raw)).toBeNull();
  });
});
