import { runProcess, stderrTail, type ProcessRunner } from './run-process';
import { FAILURE_REASONS, InvalidVideoError } from '../processing/errors';
import { type VideoMetadata, type VideoProbe } from '../processing/ports';

/**
 * Nomes de formato do demuxer mov/mp4 do ffmpeg (`mov,mp4,m4a,3gp,3g2,mj2`).
 * A API só aceita `video/mp4` e `video/quicktime`, que caem todos nesse demuxer.
 */
export const SUPPORTED_FORMAT_NAMES = ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'] as const;

export const FFPROBE_TIMEOUT_MS = 60_000;

export interface FfprobeVideoProbeOptions {
  maxDurationSeconds: number;
  runner?: ProcessRunner;
  ffprobePath?: string;
  timeoutMs?: number;
}

export function buildFfprobeArgs(filePath: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type', '-of', 'json', filePath];
}

interface FfprobeOutput {
  streams?: Array<{ codec_type?: string }>;
  format?: { format_name?: string; duration?: string };
}

/** Valida a saída JSON do ffprobe. Lança `InvalidVideoError` quando o vídeo não é aceito. */
export function parseFfprobeOutput(stdout: string, maxDurationSeconds: number): VideoMetadata {
  let output: FfprobeOutput;

  try {
    output = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new InvalidVideoError(FAILURE_REASONS.invalidVideo, 'ffprobe returned invalid JSON');
  }

  const formatName = output.format?.format_name ?? '';

  if (!output.streams?.some(stream => stream.codec_type === 'video')) {
    throw new InvalidVideoError(FAILURE_REASONS.noVideoStream, `format_name=${formatName}`);
  }

  const formatNames = formatName.split(',');

  if (!SUPPORTED_FORMAT_NAMES.some(name => formatNames.includes(name))) {
    throw new InvalidVideoError(FAILURE_REASONS.unsupportedFormat, `format_name=${formatName}`);
  }

  const durationSeconds = Number(output.format?.duration);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new InvalidVideoError(FAILURE_REASONS.unknownDuration, `duration=${output.format?.duration}`);
  }

  if (durationSeconds > maxDurationSeconds) {
    throw new InvalidVideoError(FAILURE_REASONS.tooLong(durationSeconds, maxDurationSeconds));
  }

  return { durationSeconds, formatName };
}

export class FfprobeVideoProbe implements VideoProbe {
  private readonly maxDurationSeconds: number;
  private readonly runner: ProcessRunner;
  private readonly ffprobePath: string;
  private readonly timeoutMs: number;

  constructor({
    maxDurationSeconds,
    runner = runProcess,
    ffprobePath = 'ffprobe',
    timeoutMs = FFPROBE_TIMEOUT_MS
  }: FfprobeVideoProbeOptions) {
    this.maxDurationSeconds = maxDurationSeconds;
    this.runner = runner;
    this.ffprobePath = ffprobePath;
    this.timeoutMs = timeoutMs;
  }

  public async probe(filePath: string): Promise<VideoMetadata> {
    const result = await this.runner(this.ffprobePath, buildFfprobeArgs(filePath), { timeoutMs: this.timeoutMs });

    // Morto por timeout ou sinal (ex.: OOM): não é culpa do vídeo, a mensagem volta à fila.
    if (result.timedOut || result.signal) {
      throw new Error(`ffprobe did not finish (timedOut=${result.timedOut}, signal=${result.signal})`);
    }

    if (result.exitCode !== 0) {
      throw new InvalidVideoError(FAILURE_REASONS.invalidVideo, stderrTail(result.stderr));
    }

    return parseFfprobeOutput(result.stdout, this.maxDurationSeconds);
  }
}
