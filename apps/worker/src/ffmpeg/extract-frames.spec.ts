import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildExtractFramesArgs, FfmpegFrameExtractor, listFrameFiles, parseProgressLine } from './extract-frames';
import { type ProcessResult, type ProcessRunner, type RunProcessOptions } from './run-process';
import { FAILURE_REASONS, InvalidVideoError } from '../processing/errors';

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', ...overrides };
}

describe('extract frames', () => {
  let framesDir: string;

  beforeEach(() => {
    framesDir = fs.mkdtempSync(path.join(os.tmpdir(), '4frames-frames-'));
  });

  afterEach(() => {
    fs.rmSync(framesDir, { recursive: true, force: true });
  });

  it('should keep the base project rule: -vf fps=N and frame_%04d.<format>', () => {
    const args = buildExtractFramesArgs({
      sourcePath: '/work/source.mp4',
      framesDir: '/work/frames',
      fps: 1,
      format: 'png'
    });

    expect(args.slice(args.indexOf('-i'))).toEqual([
      '-i',
      '/work/source.mp4',
      '-vf',
      'fps=1',
      '-y',
      path.join('/work/frames', 'frame_%04d.png')
    ]);
    expect(args).toEqual(expect.arrayContaining(['-progress', 'pipe:1', '-nostdin']));
  });

  it('should turn out_time_ms (microseconds) into the processed fraction', () => {
    expect(parseProgressLine('out_time_ms=22500000', 45)).toBe(0.5);
    expect(parseProgressLine('out_time_ms=99000000', 45)).toBe(1);
    expect(parseProgressLine(' out_time_ms=0\r', 45)).toBe(0);
    expect(parseProgressLine('out_time_ms=N/A', 45)).toBeUndefined();
    expect(parseProgressLine('frame=12', 45)).toBeUndefined();
    expect(parseProgressLine('out_time_ms=1000', 0)).toBeUndefined();
  });

  it('should list the generated frames in numeric order and ignore other files', async () => {
    for (const name of ['frame_10000.png', 'frame_0002.png', 'frame_0001.png', 'frame_0003.jpg', 'notes.txt']) {
      fs.writeFileSync(path.join(framesDir, name), '');
    }

    await expect(listFrameFiles(framesDir, 'png')).resolves.toEqual([
      'frame_0001.png',
      'frame_0002.png',
      'frame_10000.png'
    ]);
  });

  describe('FfmpegFrameExtractor', () => {
    function extractorWith(runner: ProcessRunner) {
      return new FfmpegFrameExtractor({ fps: 1, format: 'png', timeoutMs: 5000, runner });
    }

    it('should run ffmpeg, report progress and return the frames', async () => {
      const runner = jest.fn(async (_command: string, _args: string[], options?: RunProcessOptions) => {
        ['frame=1', 'out_time_ms=15000000', 'progress=continue', 'out_time_ms=30000000', 'progress=end'].forEach(line =>
          options?.onStdoutLine?.(line)
        );
        fs.writeFileSync(path.join(framesDir, 'frame_0001.png'), '');
        fs.writeFileSync(path.join(framesDir, 'frame_0002.png'), '');
        return result();
      });
      const onProgress = jest.fn();

      const frames = await extractorWith(runner).extract({
        sourcePath: '/work/source.mp4',
        framesDir,
        durationSeconds: 30,
        onProgress
      });

      expect(frames).toEqual(['frame_0001.png', 'frame_0002.png']);
      expect(onProgress.mock.calls).toEqual([[0.5], [1], [1]]);
      expect(runner).toHaveBeenCalledWith(
        'ffmpeg',
        buildExtractFramesArgs({ sourcePath: '/work/source.mp4', framesDir, fps: 1, format: 'png' }),
        expect.objectContaining({ timeoutMs: 5000 })
      );
    });

    it('should classify an ffmpeg decoding failure as an invalid video', async () => {
      const extractor = extractorWith(
        jest.fn().mockResolvedValue(result({ exitCode: 183, stderr: 'moov atom not found\nError opening input files' }))
      );

      await expect(extractor.extract({ sourcePath: 's', framesDir, durationSeconds: 10 })).rejects.toMatchObject({
        name: 'InvalidVideoError',
        reason: FAILURE_REASONS.invalidVideo
      });
    });

    it('should classify a video without any frame as an invalid video', async () => {
      const extractor = extractorWith(jest.fn().mockResolvedValue(result()));

      await expect(extractor.extract({ sourcePath: 's', framesDir, durationSeconds: 10 })).rejects.toMatchObject({
        reason: FAILURE_REASONS.noFrames
      });
    });

    it.each([
      ['timeout', result({ exitCode: null, signal: 'SIGKILL', timedOut: true })],
      ['killed by the OOM killer', result({ exitCode: null, signal: 'SIGKILL' })],
      ['disk full', result({ exitCode: 1, stderr: 'frame_0042.png: No space left on device' })]
    ])('should classify %s as transient', async (_name, processResult) => {
      const extractor = extractorWith(jest.fn().mockResolvedValue(processResult));

      const error = await extractor
        .extract({ sourcePath: 's', framesDir, durationSeconds: 10 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(InvalidVideoError);
    });
  });
});
