import fs from 'node:fs';
import path from 'node:path';

import archiver from 'archiver';

import { type FrameZipper, type ZipFramesInput } from '../processing/ports';

/**
 * Zip em streaming para arquivo. Como no projeto base, as entradas ficam na raiz do zip (sem pastas),
 * com Deflate, na ordem dos frames.
 */
export class ArchiverFrameZipper implements FrameZipper {
  public zip({ framesDir, frameFiles, zipPath }: ZipFramesInput): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      // O archiver grava cada arquivo quando o lstat dele termina, e por padrão faz 4 em paralelo: os frames
      // entrariam no zip fora de ordem. Um lstat por vez custa milissegundos perto da extração.
      const archive = archiver('zip', { zlib: { level: 6 }, statConcurrency: 1 });

      const fail = (error: Error) => {
        archive.abort();
        output.destroy();
        reject(error);
      };

      output.once('close', () => resolve());
      output.once('error', fail);
      archive.once('error', fail);
      // archiver emite 'warning' para arquivo ausente (ENOENT): um frame faltando invalida o zip.
      archive.once('warning', fail);

      archive.pipe(output);

      for (const file of frameFiles) {
        archive.file(path.join(framesDir, file), { name: path.basename(file) });
      }

      archive.finalize().catch(fail);
    });
  }
}
