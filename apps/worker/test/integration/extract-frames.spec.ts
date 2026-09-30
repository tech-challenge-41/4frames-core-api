import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { FfmpegFrameExtractor } from '../../src/ffmpeg/extract-frames';
import { FfprobeVideoProbe } from '../../src/ffmpeg/ffprobe';
import { FAILURE_REASONS, InvalidVideoError } from '../../src/processing/errors';
import { ArchiverFrameZipper } from '../../src/zip/zip-frames';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const VALID_VIDEO = path.join(FIXTURES_DIR, 'ex-30sec-video.mp4');
const INVALID_VIDEO = path.join(FIXTURES_DIR, 'ex-invalid-video.mp4');
/** Vídeo de 30 s com a regra do projeto base (fps=1). */
const EXPECTED_FRAME_COUNT = 30;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(binary => spawnSync(binary, ['-version']).status === 0);

// Sem ffmpeg no PATH (ex.: Windows sem ffmpeg), os testes são pulados. No container do worker e no CI rodam.
const describeWithFfmpeg = hasFfmpeg ? describe : describe.skip;

describeWithFfmpeg('frame extraction with ffmpeg (sample videos)', () => {
  let workDir: string;
  let framesDir: string;

  jest.setTimeout(120_000);

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), '4frames-integration-'));
    framesDir = path.join(workDir, 'frames');
    fs.mkdirSync(framesDir);
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('should extract 1 PNG per second and zip them at the root, like the base project', async () => {
    const probe = new FfprobeVideoProbe({ maxDurationSeconds: 600 });
    const extractor = new FfmpegFrameExtractor({ fps: 1, format: 'png', timeoutMs: 110_000 });
    const zipPath = path.join(workDir, 'frames.zip');
    const progress: number[] = [];

    const { durationSeconds, formatName } = await probe.probe(VALID_VIDEO);
    const frameFiles = await extractor.extract({
      sourcePath: VALID_VIDEO,
      framesDir,
      durationSeconds,
      onProgress: ratio => progress.push(ratio)
    });
    await new ArchiverFrameZipper().zip({ framesDir, frameFiles, zipPath });

    expect(Math.round(durationSeconds)).toBe(30);
    expect(formatName.split(',')).toContain('mp4');

    const expectedNames = Array.from(
      { length: EXPECTED_FRAME_COUNT },
      (_, index) => `frame_${String(index + 1).padStart(4, '0')}.png`
    );
    expect(frameFiles).toEqual(expectedNames);

    const entries = new AdmZip(zipPath).getEntries();
    expect(entries.map(entry => entry.entryName)).toEqual(expectedNames);
    expect(entries.every(entry => !entry.entryName.includes('/') && !entry.isDirectory)).toBe(true);
    expect(entries[0]?.getData().subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((ratio, index) => ratio >= 0 && ratio <= 1 && ratio >= (progress[index - 1] ?? 0))).toBe(
      true
    );
  });

  it('should reject an image renamed to .mp4 (ffprobe reads it, but it is not MP4/MOV)', async () => {
    const probe = new FfprobeVideoProbe({ maxDurationSeconds: 600 });

    const error = await probe.probe(INVALID_VIDEO).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidVideoError);
    expect((error as InvalidVideoError).reason).toBe(FAILURE_REASONS.unsupportedFormat);
  });

  it('should reject a text file renamed to .mp4', async () => {
    const textFile = path.join(workDir, 'notes.mp4');
    fs.writeFileSync(textFile, 'isto não é um vídeo\n'.repeat(100));

    const error = await new FfprobeVideoProbe({ maxDurationSeconds: 600 })
      .probe(textFile)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidVideoError);
    expect((error as InvalidVideoError).reason).toBe(FAILURE_REASONS.invalidVideo);
  });

  it('should reject a video longer than MAX_VIDEO_DURATION_SECONDS', async () => {
    const probe = new FfprobeVideoProbe({ maxDurationSeconds: 10 });

    await expect(probe.probe(VALID_VIDEO)).rejects.toMatchObject({
      name: 'InvalidVideoError',
      reason: expect.stringMatching(/excede o limite de 10 s$/)
    });
  });
});
