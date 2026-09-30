import { spawn } from 'node:child_process';

export interface RunProcessOptions {
  /** Mata o processo com SIGKILL ao estourar. */
  timeoutMs?: number;
  /** Chamado para cada linha completa do stdout (ex.: `-progress pipe:1` do ffmpeg). */
  onStdoutLine?: (line: string) => void;
  /** Quanto de stdout e stderr guardar, a partir do fim. */
  maxOutputChars?: number;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** Rejeita só quando o processo não chega a iniciar (ex.: binário ausente, ENOENT). */
export type ProcessRunner = (command: string, args: string[], options?: RunProcessOptions) => Promise<ProcessResult>;

const DEFAULT_MAX_OUTPUT_CHARS = 64 * 1024;

function keepTail(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

export const runProcess: ProcessRunner = (command, args, options = {}) => {
  const { timeoutMs, onStdoutLine, maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let stdout = '';
    let stderr = '';
    let pendingLine = '';
    let timedOut = false;

    const emitLine = (line: string) => {
      try {
        onStdoutLine?.(line);
      } catch {
        // Um callback com erro não pode derrubar o processo filho nem o worker.
      }
    };

    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout = keepTail(stdout + chunk, maxOutputChars);

      if (onStdoutLine) {
        const lines = (pendingLine + chunk).split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        lines.forEach(emitLine);
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderr = keepTail(stderr + chunk, maxOutputChars);
    });

    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);

      if (pendingLine && onStdoutLine) {
        emitLine(pendingLine);
      }

      resolve({ exitCode, signal, timedOut, stdout, stderr });
    });
  });
};

/** Últimas linhas do stderr, para log. */
export function stderrTail(stderr: string, maxChars = 2000): string {
  return keepTail(stderr.trim(), maxChars);
}
