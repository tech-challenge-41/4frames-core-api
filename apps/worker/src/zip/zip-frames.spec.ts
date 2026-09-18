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
