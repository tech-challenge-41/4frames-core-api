import { runProcess, stderrTail } from './run-process';

// O próprio Node faz o papel do ffmpeg: o teste roda igual no Windows, no Linux e no CI.
const node = process.execPath;

describe('runProcess', () => {
  it('should capture exit code, stdout and stderr', async () => {
    const result = await runProcess(node, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'
    ]);

    expect(result).toEqual({ exitCode: 3, signal: null, timedOut: false, stdout: 'out', stderr: 'err' });
  });

  it('should deliver stdout line by line, including a last line without newline', async () => {
    const lines: string[] = [];

    await runProcess(
      node,
      ['-e', 'process.stdout.write("a=1\\nb="); setTimeout(() => process.stdout.write("2\\r\\nc=3"), 20)'],
      {
        onStdoutLine: line => lines.push(line)
      }
    );

    expect(lines).toEqual(['a=1', 'b=2', 'c=3']);
  });

  it('should survive a callback that throws', async () => {
    const result = await runProcess(node, ['-e', 'console.log("x")'], {
      onStdoutLine: () => {
        throw new Error('boom');
      }
    });

    expect(result.exitCode).toBe(0);
  });

  it('should kill the process when the timeout expires', async () => {
    const result = await runProcess(node, ['-e', 'setTimeout(() => undefined, 10000)'], { timeoutMs: 100 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.signal !== null || result.exitCode !== 0).toBe(true);
  });

  it('should keep only the tail of long outputs', async () => {
    const result = await runProcess(node, ['-e', 'process.stderr.write("x".repeat(5000) + "END")'], {
      maxOutputChars: 10
    });

    expect(result.stderr).toBe('xxxxxxxEND');
    expect(stderrTail('  abcdef  ', 3)).toBe('def');
  });

  it('should reject when the binary does not exist', async () => {
    await expect(runProcess('4frames-binary-that-does-not-exist', [])).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
