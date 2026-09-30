import { decodeS3ObjectKey, parseS3EventMessage } from './s3-event';
import { JOB_ID, s3EventBody, SOURCE_KEY } from '../__tests__/fakes';

describe('s3 event messages', () => {
  it('should recognize the s3:TestEvent published when the notification is configured', () => {
    const body = JSON.stringify({
      Service: 'Amazon S3',
      Event: 's3:TestEvent',
      Time: '2026-09-17T12:00:00.000Z',
      Bucket: '4frames-videos'
    });

    expect(parseS3EventMessage(body)).toEqual({ kind: 'test' });
  });

  it('should extract bucket, event name and decoded key from ObjectCreated records', () => {
    expect(parseS3EventMessage(s3EventBody(SOURCE_KEY))).toEqual({
      kind: 'records',
      records: [{ eventName: 'ObjectCreated:Put', bucket: '4frames-videos', key: SOURCE_KEY }]
    });
  });

  it('should decode URL-encoded keys, with + as space', () => {
    expect(decodeS3ObjectKey('videos/1/my+video%281%29.mp4')).toBe('videos/1/my video(1).mp4');
    expect(decodeS3ObjectKey(`videos/7/${JOB_ID}/source.mp4`)).toBe(`videos/7/${JOB_ID}/source.mp4`);
  });

  it.each([
    [undefined, 'body is not JSON'],
    ['not json', 'body is not JSON'],
    ['{}', 'body is not an S3 event notification'],
    [JSON.stringify({ Records: [] }), 'body is not an S3 event notification'],
    [
      JSON.stringify({
        Records: [{ eventName: 'ObjectCreated:Put', s3: { bucket: { name: 'b' }, object: { key: '%E0%A4%A' } } }]
      }),
      'object key is not correctly encoded'
    ]
  ])('should flag an invalid message (%s)', (body, reason) => {
    expect(parseS3EventMessage(body)).toEqual({ kind: 'invalid', reason });
  });
});
