import {
  buildFrameFileName,
  buildFrameKey,
  buildVideoSourceKey,
  buildZipKey,
  contentTypeToExtension,
  parseVideoSourceKey,
  SUPPORTED_VIDEO_CONTENT_TYPES
} from './storage-keys';

describe('storage keys', () => {
  it('should map the supported content types to extensions', () => {
    expect(contentTypeToExtension('video/mp4')).toBe('mp4');
    expect(contentTypeToExtension('video/quicktime')).toBe('mov');
    expect(contentTypeToExtension('video/x-msvideo')).toBeUndefined();
    expect(SUPPORTED_VIDEO_CONTENT_TYPES).toEqual(['video/mp4', 'video/quicktime']);
  });

  it('should build the source key with the same layout used by the API today', () => {
    expect(buildVideoSourceKey(1, 42, 'mp4')).toBe('videos/1/42/source.mp4');
    expect(buildVideoSourceKey(1, '6f1c2a9e-0000-4000-8000-000000000000', 'mov')).toBe(
      'videos/1/6f1c2a9e-0000-4000-8000-000000000000/source.mov'
    );
  });

  it('should parse a source key back into owner, job and extension', () => {
    expect(parseVideoSourceKey('videos/7/abc-123/source.MP4')).toEqual({
      userId: '7',
      jobId: 'abc-123',
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
    expect(buildZipKey(1, 42)).toBe('zips/1/42.zip');
    expect(buildFrameKey(1, 42, 'frame_0001.png')).toBe('frames/1/42/frame_0001.png');
  });

  it('should name frames like the base project (frame_%04d.png)', () => {
    expect(buildFrameFileName(1)).toBe('frame_0001.png');
    expect(buildFrameFileName(45)).toBe('frame_0045.png');
    expect(buildFrameFileName(12345, 'jpg')).toBe('frame_12345.jpg');
    expect(() => buildFrameFileName(0)).toThrow(RangeError);
    expect(() => buildFrameFileName(1.5)).toThrow(RangeError);
  });
});
