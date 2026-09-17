import fs from 'node:fs/promises';
import path from 'node:path';

import { runProcess, stderrTail, type ProcessRunner } from './run-process';
import { type FrameFormat } from '../config/worker-env';
import { FAILURE_REASONS, InvalidVideoError } from '../processing/errors';
import { type ExtractFramesInput, type FrameExtractor } from '../processing/ports';

export interface FfmpegFrameExtractorOptions {
  fps: number;
  format: FrameFormat;
  timeoutMs: number;
  runner?: ProcessRunner;
  ffmpegPath?: string;
}

/**
 * Mesma regra do projeto base (`ffmpeg -i <video> -vf fps=1 -y frame_%04d.png`).
 * As opções globais só controlam log e progresso e não mudam os frames gerados.
 */
export function buildExtractFramesArgs(input: {
  sourcePath: string;
  framesDir: string;
  fps: number;
  format: FrameFormat;
}): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'error',
    '-progress',
    'pipe:1',
    '-i',
    input.sourcePath,
    '-vf',
    `fps=${input.fps}`,
    '-y',
    path.join(input.framesDir, `frame_%04d.${input.format}`)
  ];
}

/**
 * Lê uma linha do `-progress` e devolve a fração processada (0–1).
 * Apesar do nome, `out_time_ms` vem em microssegundos.
 */
export function parseProgressLine(line: string, durationSeconds: number): number | undefined {
  const match = /^out_time_ms=(\d+)$/.exec(line.trim());

  if (!match || durationSeconds <= 0) {
    return undefined;
  }

  const processedSeconds = Number(match[1]) / 1_000_000;

  return Math.min(1, Math.max(0, processedSeconds / durationSeconds));
}

/** Frames gerados (`frame_0001.png`…), ordenados pelo número. */
export async function listFrameFiles(framesDir: string, format: string): Promise<string[]> {
  const pattern = new RegExp(`^frame_(\\d{4,})\\.${format}$`);
  const entries = await fs.readdir(framesDir);

  return entries
    .map(name => ({ name, match: pattern.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map(entry => entry.name);
}

// Falta de recurso da máquina, não do vídeo: a mensagem deve voltar à fila.
const RESOURCE_ERROR_PATTERN = /no space left on device|cannot allocate memory|out of memory/i;

export class FfmpegFrameExtractor implements FrameExtractor {
  private readonly fps: number;
  private readonly format: FrameFormat;
  private readonly timeoutMs: number;
  private readonly runner: ProcessRunner;
  private readonly ffmpegPath: string;

  constructor({ fps, format, timeoutMs, runner = runProcess, ffmpegPath = 'ffmpeg' }: FfmpegFrameExtractorOptions) {
    this.fps = fps;
    this.format = format;
    this.timeoutMs = timeoutMs;
    this.runner = runner;
    this.ffmpegPath = ffmpegPath;
  }

  public async extract({ sourcePath, framesDir, durationSeconds, onProgress }: ExtractFramesInput): Promise<string[]> {
    const args = buildExtractFramesArgs({ sourcePath, framesDir, fps: this.fps, format: this.format });

    const result = await this.runner(this.ffmpegPath, args, {
      timeoutMs: this.timeoutMs,
      onStdoutLine: line => {
        const ratio = parseProgressLine(line, durationSeconds);

        if (ratio !== undefined) {
          onProgress?.(ratio);
        }
      }
    });

    if (result.timedOut) {
      throw new Error(`ffmpeg timed out after ${this.timeoutMs}ms`);
    }

    if (result.signal) {
      throw new Error(`ffmpeg was killed by ${result.signal}`);
    }

    if (result.exitCode !== 0) {
      const details = stderrTail(result.stderr);

      if (RESOURCE_ERROR_PATTERN.test(details)) {
        throw new Error(`ffmpeg failed for lack of resources: ${details}`);
      }

      throw new InvalidVideoError(FAILURE_REASONS.invalidVideo, details);
    }

    const frameFiles = await listFrameFiles(framesDir, this.format);

    if (frameFiles.length === 0) {
      throw new InvalidVideoError(FAILURE_REASONS.noFrames, stderrTail(result.stderr));
    }

    onProgress?.(1);

    return frameFiles;
  }
}
