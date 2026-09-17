import { buildFfprobeArgs, FfprobeVideoProbe, parseFfprobeOutput } from './ffprobe';
import { type ProcessResult, type ProcessRunner } from './run-process';
import { FAILURE_REASONS, InvalidVideoError } from '../processing/errors';

function probeOutput({
  formatName = 'mov,mp4,m4a,3gp,3g2,mj2',
  duration = '45.045000',
  codecTypes = ['video', 'audio']
}: { formatName?: string; duration?: string; codecTypes?: string[] } = {}): string {
  return JSON.stringify({
    programs: [],
    streams: codecTypes.map(codecType => ({ codec_type: codecType })),
    format: { format_name: formatName, duration }
  });
}

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', ...overrides };
}

describe('ffprobe', () => {
  it('should ask ffprobe for duration, format and stream types as JSON', () => {
    expect(buildFfprobeArgs('/tmp/4frames/job/source.mp4')).toEqual([
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name:stream=codec_type',
      '-of',
      'json',
      '/tmp/4frames/job/source.mp4'
    ]);
  });

  describe('parseFfprobeOutput', () => {
    it('should accept an MP4/MOV video within the duration limit', () => {
      expect(parseFfprobeOutput(probeOutput(), 600)).toEqual({
        durationSeconds: 45.045,
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2'
      });
    });

    it.each([
      ['not json', 'x', FAILURE_REASONS.invalidVideo],
      ['audio only', probeOutput({ codecTypes: ['audio'] }), FAILURE_REASONS.noVideoStream],
      ['image renamed to .mp4', probeOutput({ formatName: 'png_pipe' }), FAILURE_REASONS.unsupportedFormat],
      ['matroska', probeOutput({ formatName: 'matroska,webm' }), FAILURE_REASONS.unsupportedFormat],
      ['duration N/A', probeOutput({ duration: 'N/A' }), FAILURE_REASONS.unknownDuration],
      ['zero duration', probeOutput({ duration: '0.000000' }), FAILURE_REASONS.unknownDuration],
      ['too long', probeOutput({ duration: '600.5' }), FAILURE_REASONS.tooLong(600.5, 600)]
    ])('should reject %s', (_name, stdout, reason) => {
      expect(() => parseFfprobeOutput(stdout, 600)).toThrow(new InvalidVideoError(reason));
    });

    it('should explain the duration limit to the user', () => {
      expect(FAILURE_REASONS.tooLong(600.5, 600)).toBe('O vídeo tem 601 s e excede o limite de 600 s');
    });
  });

  describe('FfprobeVideoProbe', () => {
    it('should run ffprobe with a timeout and return the metadata', async () => {
      const runner = jest
        .fn<ReturnType<ProcessRunner>, Parameters<ProcessRunner>>()
        .mockResolvedValue(result({ stdout: probeOutput() }));
      const probe = new FfprobeVideoProbe({ maxDurationSeconds: 600, runner, timeoutMs: 1234 });

      await expect(probe.probe('/tmp/video.mp4')).resolves.toMatchObject({ durationSeconds: 45.045 });
      expect(runner).toHaveBeenCalledWith('ffprobe', buildFfprobeArgs('/tmp/video.mp4'), { timeoutMs: 1234 });
    });

    it('should classify a non-zero exit (unreadable file) as an invalid video', async () => {
      const runner = jest
        .fn()
        .mockResolvedValue(
          result({ exitCode: 1, stderr: '/tmp/video.mp4: Invalid data found when processing input\n' })
        );
      const probe = new FfprobeVideoProbe({ maxDurationSeconds: 600, runner });

      const error = await probe.probe('/tmp/video.mp4').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidVideoError);
      expect(error).toMatchObject({
        reason: FAILURE_REASONS.invalidVideo,
        details: '/tmp/video.mp4: Invalid data found when processing input'
      });
    });

    it.each([
      result({ exitCode: null, timedOut: true, signal: 'SIGKILL' }),
      result({ exitCode: null, signal: 'SIGKILL' })
    ])('should classify a killed ffprobe as transient', async processResult => {
      const probe = new FfprobeVideoProbe({
        maxDurationSeconds: 600,
        runner: jest.fn().mockResolvedValue(processResult)
      });

      const error = await probe.probe('/tmp/video.mp4').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(InvalidVideoError);
    });

    it('should let a missing binary propagate as a transient error', async () => {
      const runner = jest.fn().mockRejectedValue(Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }));
      const probe = new FfprobeVideoProbe({ maxDurationSeconds: 600, runner });

      await expect(probe.probe('/tmp/video.mp4')).rejects.toThrow('spawn ffprobe ENOENT');
    });
  });
});
