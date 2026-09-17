import {
  buildFrameFileName,
  buildFrameKey,
  buildVideoSourceKey,
  buildZipKey,
  contentTypeToExtension,
  parseVideoSourceKey,
  SUPPORTED_VIDEO_CONTENT_TYPES
} from './storage-keys';

const JOB_ID = '6f1c2a9e-4b7d-4c1a-9f3e-2d8b5a7c9e10';

describe('storage keys', () => {
  it('should map the supported content types to extensions', () => {
    expect(contentTypeToExtension('video/mp4')).toBe('mp4');
    expect(contentTypeToExtension('video/quicktime')).toBe('mov');
    expect(contentTypeToExtension('video/x-msvideo')).toBeUndefined();
    expect(SUPPORTED_VIDEO_CONTENT_TYPES).toEqual(['video/mp4', 'video/quicktime']);
  });

  it('should build the source key as videos/{userId}/{jobId}/source.{ext}', () => {
    expect(buildVideoSourceKey(1, JOB_ID, 'mp4')).toBe(`videos/1/${JOB_ID}/source.mp4`);
    expect(buildVideoSourceKey('7', JOB_ID, 'mov')).toBe(`videos/7/${JOB_ID}/source.mov`);
  });

  it('should parse a source key back into owner, job and extension', () => {
    expect(parseVideoSourceKey(`videos/7/${JOB_ID}/source.MP4`)).toEqual({
      userId: '7',
      jobId: JOB_ID,
      extension: 'mp4'
    });
  });

  it.each(['zips/1/2.zip', 'frames/1/2/frame_0001.png', 'videos/1/source.mp4', 'videos/1/2/other.mp4', ''])(
    'should return null for a key that is not a video source (%s)',
    key => {
      expect(parseVideoSourceKey(key)).toBeNull();
    }
  );

  it('should build zip and frame keys outside the videos/ prefix', () => {
    expect(buildZipKey(1, JOB_ID)).toBe(`zips/1/${JOB_ID}.zip`);
    expect(buildFrameKey(1, JOB_ID, 'frame_0001.png')).toBe(`frames/1/${JOB_ID}/frame_0001.png`);
  });

  it('should name frames like the base project (frame_%04d.png)', () => {
    expect(buildFrameFileName(1)).toBe('frame_0001.png');
    expect(buildFrameFileName(45)).toBe('frame_0045.png');
    expect(buildFrameFileName(12345, 'jpg')).toBe('frame_12345.jpg');
    expect(() => buildFrameFileName(0)).toThrow(RangeError);
    expect(() => buildFrameFileName(1.5)).toThrow(RangeError);
  });
});
