import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { ArchiverFrameZipper } from './zip-frames';

describe('ArchiverFrameZipper', () => {
  let workDir: string;
  let framesDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), '4frames-zip-'));
    framesDir = path.join(workDir, 'frames');
    fs.mkdirSync(framesDir);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('should put every frame at the root of the zip, like the base project', async () => {
    const frameFiles = ['frame_0001.png', 'frame_0002.png', 'frame_0003.png'];
    frameFiles.forEach((file, index) => fs.writeFileSync(path.join(framesDir, file), `png-${index + 1}`));
    const zipPath = path.join(workDir, 'frames.zip');

    await new ArchiverFrameZipper().zip({ framesDir, frameFiles, zipPath });

    const entries = new AdmZip(zipPath).getEntries();
    expect(entries.map(entry => entry.entryName)).toEqual(frameFiles);
    expect(entries.every(entry => !entry.isDirectory)).toBe(true);
    expect(entries[1]?.getData().toString()).toBe('png-2');
  });

  it('should keep the frames in order even when the stat of the first one is the slowest', async () => {
    const frameFiles = Array.from({ length: 5 }, (_, index) => `frame_${String(index + 1).padStart(4, '0')}.png`);
    frameFiles.forEach(file => fs.writeFileSync(path.join(framesDir, file), 'png'));
    const zipPath = path.join(workDir, 'frames.zip');

    // O archiver consulta o lstat de cada arquivo antes de gravá-lo no zip. Atrasar o do primeiro frame reproduz,
    // sempre, o que o disco às vezes faz sozinho: sem stats em sequência, ele entraria no zip depois dos outros.
    const lstat = fs.lstat;
    jest.spyOn(fs, 'lstat').mockImplementation(((filePath: fs.PathLike, callback: (...args: unknown[]) => void) => {
      const delayMs = String(filePath).endsWith(frameFiles[0]!) ? 50 : 0;
      lstat(filePath, (error, stats) => setTimeout(() => callback(error, stats), delayMs));
    }) as unknown as typeof fs.lstat);

    await new ArchiverFrameZipper().zip({ framesDir, frameFiles, zipPath });

    expect(new AdmZip(zipPath).getEntries().map(entry => entry.entryName)).toEqual(frameFiles);
  });

  it('should fail when a frame is missing', async () => {
    fs.writeFileSync(path.join(framesDir, 'frame_0001.png'), 'png');

    await expect(
      new ArchiverFrameZipper().zip({
        framesDir,
        frameFiles: ['frame_0001.png', 'frame_0002.png'],
        zipPath: path.join(workDir, 'frames.zip')
      })
    ).rejects.toThrow();
  });
});
